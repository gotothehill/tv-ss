import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Play, 
  Activity, 
  Wifi, 
  WifiOff, 
  Search, 
  BarChart3,
  Tv,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Signal,
  Globe,
  MonitorPlay,
  AlertCircle,
  ShieldAlert
} from 'lucide-react';
import { Channel, Source, StreamStats } from './types';
import { PRESETS, BATCH_SIZE, TIMEOUT_MS } from './constants';
import { parseAndAggregate } from './utils/parser';
import VideoPlayer from './components/VideoPlayer';

function App() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  
  // Checking State
  const [isChecking, setIsChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState(0);
  const [totalToCheck, setTotalToCheck] = useState(0);
  const [checkedCount, setCheckedCount] = useState(0);

  // UI State
  const [activeSource, setActiveSource] = useState<{ url: string, name: string, resolution?: string, latency?: number | null } | null>(null);
  const [filterText, setFilterText] = useState('');
  const [activeTab, setActiveTab] = useState<'All' | 'China' | 'International'>('China');
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(new Set());

  // Initialize Data
  useEffect(() => {
    const loadPresets = async () => {
      setLoadingData(true);
      const promises = PRESETS.map(async (preset) => {
        try {
          const res = await fetch(preset.url);
          if (!res.ok) return null;
          const content = await res.text();
          return { content, category: preset.category };
        } catch (e) {
          console.error(`Failed to load ${preset.name}`, e);
          return null;
        }
      });

      const results = await Promise.all(promises);
      const validResults = results.filter((r): r is { content: string, category: 'China' | 'International' } => r !== null);
      
      const aggregated = parseAndAggregate(validResults);
      setChannels(aggregated);
      setLoadingData(false);
    };

    loadPresets();
  }, []);

  // Compute Stats
  const stats: StreamStats = useMemo(() => {
    let totalCh = channels.length;
    let totalSrc = 0;
    let onlineSrc = 0;
    let totalLatency = 0;
    let latencyCount = 0;

    channels.forEach(ch => {
      totalSrc += ch.sources.length;
      ch.sources.forEach(s => {
        if (s.status === 'online') {
          onlineSrc++;
          if (s.latency) {
            totalLatency += s.latency;
            latencyCount++;
          }
        }
      });
    });

    return {
      totalChannels: totalCh,
      totalSources: totalSrc,
      onlineSources: onlineSrc,
      avgLatency: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0
    };
  }, [channels]);

  // Check Logic (Single Channel or All)
  const runCheck = async (targetChannels: Channel[]) => {
    if (isChecking || targetChannels.length === 0) return;
    
    setIsChecking(true);
    setCheckedCount(0);
    
    // Flatten all sources needed to check
    const tasks: { channelId: string, sourceId: string, url: string }[] = [];
    targetChannels.forEach(ch => {
      ch.sources.forEach(src => {
        tasks.push({ channelId: ch.id, sourceId: src.id, url: src.url });
      });
    });

    setTotalToCheck(tasks.length);

    // UPDATE 1: Set status to 'checking' IMMEDIATELY for all target sources
    setChannels(prev => {
      const next = [...prev];
      tasks.forEach(task => {
        const chIndex = next.findIndex(c => c.id === task.channelId);
        if (chIndex !== -1) {
          const ch = { ...next[chIndex] };
          const srcIndex = ch.sources.findIndex(s => s.id === task.sourceId);
          if (srcIndex !== -1) {
            const newSources = [...ch.sources];
            newSources[srcIndex] = { ...newSources[srcIndex], status: 'checking', latency: null };
            ch.sources = newSources;
            next[chIndex] = ch;
          }
        }
      });
      return next;
    });

    // Helper to check one source
    const checkSource = async (task: typeof tasks[0]) => {
      const start = performance.now();
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
        
        const response = await fetch(task.url, { 
          method: 'GET', 
          signal: controller.signal,
          mode: 'cors' 
        });
        
        clearTimeout(id);
        const end = performance.now();
        
        let resolution: string | undefined = undefined;
        if (response.ok) {
           // Try resolution parse
           try {
             if (response.body) {
                const reader = response.body.getReader();
                const { value } = await reader.read();
                reader.cancel();
                if (value) {
                  const text = new TextDecoder().decode(value);
                  const matches = [...text.matchAll(/RESOLUTION=(\d+)x(\d+)/g)];
                  if (matches.length > 0) {
                    const maxHeight = Math.max(...matches.map(m => parseInt(m[2], 10)));
                    resolution = maxHeight >= 1080 ? '1080P' : maxHeight >= 720 ? '720P' : `${maxHeight}P`;
                  }
                }
             }
           } catch (e) {}
        }

        return {
          ...task,
          status: response.ok ? 'online' : 'offline',
          latency: response.ok ? Math.round(end - start) : null,
          resolution
        };
      } catch (e) {
        // Network Error or CORS error
        return { ...task, status: 'error', latency: null, resolution: undefined };
      }
    };

    // Batch Execution
    for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
      const batch = tasks.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(checkSource));

      // Update State
      setChannels(prev => {
        const next = [...prev];
        results.forEach(res => {
          const chIndex = next.findIndex(c => c.id === res.channelId);
          if (chIndex !== -1) {
            const ch = { ...next[chIndex] }; // copy channel
            const srcIndex = ch.sources.findIndex(s => s.id === res.sourceId);
            if (srcIndex !== -1) {
              // Update source
              const newSources = [...ch.sources];
              newSources[srcIndex] = {
                ...newSources[srcIndex],
                status: res.status as any,
                latency: res.latency,
                resolution: res.resolution
              };
              
              // Sort sources: Online > Unknown(Error) > Offline
              newSources.sort((a, b) => {
                const getScore = (s: Source) => {
                  if (s.status === 'online') return 100000 - (s.latency || 0);
                  if (s.status === 'error') return 50000; // Prioritize error over offline/idle, as it might just be CORS
                  if (s.status === 'checking') return 100;
                  return 0;
                };
                return getScore(b) - getScore(a);
              });

              ch.sources = newSources;
              ch.bestSource = newSources[0]; // Best is top sorted
              next[chIndex] = ch;
            }
          }
        });
        return next;
      });

      setCheckedCount(prev => prev + results.length);
      setCheckProgress(((i + results.length) / tasks.length) * 100);
    }

    setIsChecking(false);
  };

  const handleCheckAll = () => {
    // Check all filtered channels (or visible ones)
    runCheck(filteredChannels);
  };

  const handleCheckChannel = (e: React.MouseEvent, channel: Channel) => {
    e.stopPropagation();
    runCheck([channel]);
  };

  const toggleExpand = (id: string) => {
    const newSet = new Set(expandedChannels);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setExpandedChannels(newSet);
  };

  const handlePlaySource = (e: React.MouseEvent, source: Source, channelName: string) => {
    e.stopPropagation();
    setActiveSource({
      url: source.url,
      name: channelName,
      resolution: source.resolution,
      latency: source.latency
    });
  };

  const handlePlayBest = (e: React.MouseEvent, channel: Channel) => {
    e.stopPropagation();
    // Prefer online source, but fallback to first source if only errors exist
    const targetSource = (channel.bestSource && channel.bestSource.status === 'online') 
      ? channel.bestSource 
      : channel.sources[0];

    if (targetSource) {
      setActiveSource({
        url: targetSource.url,
        name: channel.name,
        resolution: targetSource.resolution,
        latency: targetSource.latency
      });
    } else {
       if (!expandedChannels.has(channel.id)) toggleExpand(channel.id);
    }
  };

  const filteredChannels = useMemo(() => {
    return channels.filter(c => {
      const matchFilter = c.name.toLowerCase().includes(filterText.toLowerCase());
      const matchTab = activeTab === 'All' ? true : c.category === activeTab;
      return matchFilter && matchTab;
    });
  }, [channels, filterText, activeTab]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-cyan-900 selection:text-white">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-cyan-600 rounded-lg flex items-center justify-center shadow-lg shadow-cyan-900/20">
                <Tv className="text-white" size={24} />
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                  IPTV 监控 & 播放器
                </h1>
                <p className="text-xs text-slate-400">直播源质量检测工具</p>
              </div>
            </div>

            {/* Stats Bar */}
            <div className="flex gap-4 text-sm bg-slate-800/50 p-2 rounded-lg border border-slate-700/50">
              <div className="flex items-center gap-2 text-slate-400">
                <Activity size={16} />
                <span className="font-mono text-white">{stats.totalChannels}</span> 频道
              </div>
              <div className="hidden sm:flex items-center gap-2 text-slate-500">
                <Signal size={16} />
                <span className="font-mono text-white">{stats.totalSources}</span> 信号源
              </div>
              <div className="flex items-center gap-2 text-green-400">
                <Wifi size={16} />
                <span className="font-mono">{stats.onlineSources}</span> 有效
              </div>
              <div className="flex items-center gap-2 text-yellow-400 pl-2 border-l border-slate-700">
                <BarChart3 size={16} />
                <span className="font-mono">{stats.avgLatency}ms</span> 延迟
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6 space-y-6">
        
        {/* Controls */}
        <div className="flex flex-col md:flex-row justify-between gap-4">
          {/* Tabs */}
          <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800 w-full md:w-auto">
             {(['China', 'International', 'All'] as const).map(tab => (
               <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 md:flex-none px-6 py-2 rounded-md text-sm font-medium transition-all ${activeTab === tab ? 'bg-cyan-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
               >
                 {tab === 'China' ? '国内频道' : tab === 'International' ? '国际频道' : '全部'}
               </button>
             ))}
          </div>

          <div className="flex gap-3 w-full md:w-auto">
             <div className="relative flex-1 md:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input 
                  type="text" 
                  placeholder="搜索频道..." 
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
             </div>
             
             <button 
                onClick={handleCheckAll}
                disabled={isChecking || loadingData}
                className={`px-6 py-2 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-all min-w-[140px]
                  ${isChecking 
                    ? 'bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-700' 
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/50 border border-indigo-500/50'
                  }`}
              >
                {isChecking ? <RefreshCw className="animate-spin" size={16} /> : <Activity size={16} />}
                {isChecking ? `检测中 ${Math.round(checkProgress)}%` : '检测全部'}
              </button>
          </div>
        </div>

        {/* Global Progress Bar */}
        {isChecking && (
          <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
             <div 
               className="bg-indigo-500 h-full transition-all duration-300 ease-out"
               style={{ width: `${checkProgress}%` }}
             />
          </div>
        )}

        {/* Channel List */}
        <div className="space-y-3">
          {loadingData ? (
             <div className="text-center py-20 text-slate-500 flex flex-col items-center">
                <RefreshCw className="animate-spin mb-4 text-cyan-500" size={32} />
                <p>正在加载直播源数据...</p>
             </div>
          ) : filteredChannels.length === 0 ? (
             <div className="text-center py-20 text-slate-500">
                未找到匹配的频道
             </div>
          ) : (
            filteredChannels.map(channel => {
              const hasBest = !!channel.bestSource;
              // Online is true only if status is explicitly online
              const isOnline = hasBest && channel.bestSource?.status === 'online';
              const isExpanded = expandedChannels.has(channel.id);
              
              // Determine if this channel has any sources being checked right now
              const isChannelChecking = channel.sources.some(s => s.status === 'checking');
              // Determine if we have "Error" sources which might just be CORS issues
              const hasErrors = channel.sources.some(s => s.status === 'error');

              return (
                <div key={channel.id} className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition-colors">
                  {/* Channel Header Row */}
                  <div 
                    onClick={() => toggleExpand(channel.id)}
                    className="flex items-center p-4 cursor-pointer hover:bg-slate-800/50 transition-colors"
                  >
                    <div className="mr-3 text-slate-500">
                      {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                    </div>
                    
                    {/* Icon / Avatar */}
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mr-4 
                      ${isOnline ? 'bg-green-500/10 text-green-400' : hasErrors ? 'bg-orange-500/10 text-orange-400' : 'bg-slate-800 text-slate-500'}`}>
                      {channel.category === 'China' ? <Tv size={20} /> : <Globe size={20} />}
                    </div>

                    {/* Name & Badge */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                         <h3 className="font-medium text-slate-200 truncate">{channel.name}</h3>
                         <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                            {channel.sources.length} 源
                         </span>
                         {channel.group && (
                           <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700 hidden sm:inline-block">
                             {channel.group}
                           </span>
                         )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs">
                        {isChannelChecking ? (
                           <span className="text-cyan-400 flex items-center gap-1">
                             <RefreshCw size={10} className="animate-spin" /> 检测中...
                           </span>
                        ) : isOnline ? (
                          <>
                            <span className="text-green-400 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> 在线
                            </span>
                            {channel.bestSource?.resolution && (
                               <span className="text-indigo-400 bg-indigo-500/10 px-1 rounded">{channel.bestSource.resolution}</span>
                            )}
                            <span className={`${(channel.bestSource?.latency || 9999) < 500 ? 'text-green-400' : 'text-yellow-400'}`}>
                              {channel.bestSource?.latency}ms
                            </span>
                          </>
                        ) : hasErrors ? (
                          <span className="text-orange-400 flex items-center gap-1" title="浏览器无法直接检测，但可能可以播放">
                             <ShieldAlert size={12} /> 未知 (CORS)
                          </span>
                        ) : hasBest && channel.bestSource?.status === 'offline' ? (
                          <span className="text-red-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span> 离线
                          </span>
                        ) : (
                          <span className="text-slate-600">未检测</span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                       <button 
                         onClick={(e) => handleCheckChannel(e, channel)}
                         className="p-2 text-slate-400 hover:text-cyan-400 hover:bg-cyan-950/50 rounded-lg transition-colors"
                         title="检测此频道所有源"
                       >
                         <RefreshCw size={18} className={isChannelChecking ? "animate-spin text-cyan-400" : ""} />
                       </button>
                       <button 
                         onClick={(e) => handlePlayBest(e, channel)}
                         className={`p-2 rounded-lg transition-colors flex items-center gap-2
                           ${isOnline 
                             ? 'bg-cyan-600 text-white shadow-lg hover:bg-cyan-500' 
                             : 'bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300'}`}
                       >
                         <Play size={18} fill={isOnline ? "currentColor" : "none"} />
                         <span className="hidden sm:inline text-xs font-medium">播放</span>
                       </button>
                    </div>
                  </div>

                  {/* Sources List (Expanded) */}
                  {isExpanded && (
                    <div className="border-t border-slate-800 bg-slate-950/30">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs sm:text-sm">
                          <thead className="text-slate-500 font-medium border-b border-slate-800/50">
                             <tr>
                               <th className="px-4 py-2 w-12 text-center">#</th>
                               <th className="px-4 py-2">源地址 (URL)</th>
                               <th className="px-4 py-2 w-24 text-center">格式</th>
                               <th className="px-4 py-2 w-28 text-center">状态</th>
                               <th className="px-4 py-2 w-20 text-right">操作</th>
                             </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/50">
                             {channel.sources.map((source, idx) => (
                               <tr key={source.id} className="hover:bg-slate-800/30 transition-colors">
                                 <td className="px-4 py-3 text-center text-slate-600">{idx + 1}</td>
                                 <td className="px-4 py-3 font-mono text-slate-400 truncate max-w-[150px] sm:max-w-xs" title={source.url}>
                                   {source.url}
                                 </td>
                                 <td className="px-4 py-3 text-center">
                                    {source.resolution ? (
                                      <span className="bg-indigo-900/30 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-900/50">
                                        {source.resolution}
                                      </span>
                                    ) : '-'}
                                 </td>
                                 <td className="px-4 py-3 text-center">
                                   {source.status === 'checking' ? (
                                      <RefreshCw size={12} className="animate-spin inline text-cyan-500" />
                                   ) : source.status === 'online' ? (
                                     <span className={`${(source.latency || 9999) < 200 ? 'text-green-400' : 'text-yellow-400'}`}>
                                       {source.latency}ms
                                     </span>
                                   ) : source.status === 'offline' ? (
                                     <span className="text-red-500">失效</span>
                                   ) : source.status === 'error' ? (
                                      <span className="text-orange-400 flex items-center justify-center gap-1 cursor-help" title="浏览器跨域限制，无法检测延迟，但点击播放可能可用">
                                        <AlertCircle size={12} /> N/A (CORS)
                                      </span>
                                   ) : (
                                     <span className="text-slate-600">-</span>
                                   )}
                                 </td>
                                 <td className="px-4 py-3 text-right">
                                    <button 
                                      onClick={(e) => handlePlaySource(e, source, channel.name)}
                                      className="text-slate-400 hover:text-white p-1 hover:bg-slate-700 rounded transition-colors"
                                      title="尝试播放"
                                    >
                                      <MonitorPlay size={16} />
                                    </button>
                                 </td>
                               </tr>
                             ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Floating Player */}
      {activeSource && (
        <VideoPlayer 
          url={activeSource.url}
          name={activeSource.name}
          resolution={activeSource.resolution}
          latency={activeSource.latency}
          onClose={() => setActiveSource(null)} 
        />
      )}
    </div>
  );
}

export default App;