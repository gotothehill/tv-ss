import { Channel, Source } from '../types';

const generateId = () => Math.random().toString(36).substr(2, 9);

/**
 * Normalizes channel names to improve grouping (e.g., "CCTV 1" -> "CCTV-1")
 */
const normalizeName = (name: string): string => {
  let n = name.toUpperCase();
  
  // 1. Remove content in brackets/parentheses first (e.g. [IPv6], (HEVC))
  n = n.replace(/\[.*?\]/g, '').replace(/（.*?）/g, '').replace(/\(.*?\)/g, '');
  
  // 2. Normalize CCTV formats
  // Matches CCTV1, CCTV 1, CCTV-1 -> CCTV-1
  n = n.replace(/CCTV\s*[-]?\s*(\d+)(\+)?/g, 'CCTV-$1$2');
  
  // 3. Remove common keywords that don't change the channel identity
  const keywords = [
    'HD', 'FHD', 'SD', 'UHD', 
    'HEVC', 'H.265', 'H264', 
    'IPTV', 'LIVE', '直播', 
    '高清', '超清', '标清', '频道', 
    'TEST', '测试', 
    'IPV6', 'IPV4', 
    '1080P', '720P', '4K', '8K', 
    '50FPS', '60FPS',
    '电信', '联通', '移动', '酒店'
  ];
  
  keywords.forEach(k => {
    n = n.replace(new RegExp(k, 'g'), '');
  });
  
  // 4. Remove all whitespace
  n = n.replace(/\s+/g, '');
  
  // 5. Remove trailing separators
  n = n.replace(/[-_]+$/, '');
  
  return n.trim();
};

/**
 * Aggregates multiple playlist contents into a unified Channel list
 */
export const parseAndAggregate = (
  playlists: { content: string, category: 'China' | 'International' }[]
): Channel[] => {
  const channelMap = new Map<string, Channel>();

  // Helper to add a channel to the map
  const addChannelToMap = (name: string, group: string, url: string, category: 'China' | 'International') => {
    // Basic cleanup of the display name before normalization logic
    const cleanName = name.trim();
    const normalizedKey = normalizeName(cleanName);
    
    // Skip invalid or empty names
    if (!normalizedKey || normalizedKey.length < 2) return;

    if (!channelMap.has(normalizedKey)) {
      channelMap.set(normalizedKey, {
        id: generateId(),
        name: cleanName, // Use the first encountered name as display name
        group: group || 'Other',
        category: category,
        sources: [],
        bestSource: undefined
      });
    }

    const channel = channelMap.get(normalizedKey)!;
    
    // Avoid duplicate URLs for the same channel
    if (!channel.sources.some(s => s.url === url)) {
      channel.sources.push({
        id: generateId(),
        url: url,
        status: 'idle',
        latency: null
      });
    }
  };

  playlists.forEach(({ content, category }) => {
    const lines = content.split('\n');
    let currentName = '';
    let currentGroup = '';

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      // 1. Handle M3U Metadata
      if (line.startsWith('#EXTINF:')) {
        // Extract group
        const groupMatch = line.match(/group-title="([^"]*)"/);
        currentGroup = groupMatch ? groupMatch[1] : 'Uncategorized';
        
        // Extract name (handle tvg-name or trailing name)
        // Some M3U's use tvg-name="CCTV-1"
        const tvgNameMatch = line.match(/tvg-name="([^"]*)"/);
        
        const nameParts = line.split(',');
        const trailingName = nameParts[nameParts.length - 1].trim();
        
        // Prefer tvg-name if available and reasonable, else use trailing name
        currentName = tvgNameMatch ? tvgNameMatch[1] : trailingName;
        
        // Fallback if extracted name is empty
        if (!currentName) currentName = trailingName;

      } 
      // 2. Handle TXT format: "Channel Name,http://..."
      else if (line.includes(',') && !line.startsWith('#')) {
         const parts = line.split(',');
         const possibleUrl = parts[parts.length - 1].trim();
         
         // Simple validation: must look like a URL
         if (possibleUrl.startsWith('http') || possibleUrl.startsWith('rtmp') || possibleUrl.startsWith('p2p')) {
           const name = parts.slice(0, parts.length - 1).join(',').trim();
           // TXT usually doesn't have group info, default to Uncategorized or try to infer?
           addChannelToMap(name, 'Other', possibleUrl, category);
           
           // Reset state to avoid M3U logic picking up weird things
           currentName = '';
         }
      }
      // 3. Handle M3U URL line
      else if (!line.startsWith('#') && (line.startsWith('http') || line.startsWith('rtmp'))) {
        if (currentName) {
          addChannelToMap(currentName, currentGroup, line, category);
          // Don't reset currentName/Group immediately as some M3Us might list multiple URLs for one EXTINF (rare but possible)
        }
      }
    }
  });

  return Array.from(channelMap.values()).sort((a, b) => {
    // Prioritize CCTV
    const isCCTVa = a.name.toUpperCase().includes('CCTV');
    const isCCTVb = b.name.toUpperCase().includes('CCTV');
    if (isCCTVa && !isCCTVb) return -1;
    if (!isCCTVa && isCCTVb) return 1;
    
    // Prioritize WeiShi (Satellite TV)
    const isWSa = a.name.includes('卫视');
    const isWSb = b.name.includes('卫视');
    if (isWSa && !isWSb) return -1;
    if (!isWSa && isWSb) return 1;

    return a.name.localeCompare(b.name, 'zh-CN');
  });
};
