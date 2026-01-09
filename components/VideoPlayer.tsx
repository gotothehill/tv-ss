import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { X, RefreshCw, AlertTriangle } from 'lucide-react';

interface VideoPlayerProps {
  url: string;
  name: string;
  resolution?: string;
  latency?: number | null;
  onClose: () => void;
  onError?: () => void;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ url, name, resolution, latency, onClose, onError }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setLoading(true);

    const handleMediaError = () => {
       setError("播放失败 (Playback Failed)");
       if (onError) onError();
    };

    if (Hls.isSupported()) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });
      hlsRef.current = hls;

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        video.play().catch(e => console.warn("Autoplay blocked", e));
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.error("HLS Network error");
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error("HLS Media error");
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              handleMediaError();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      video.src = url;
      video.addEventListener('loadedmetadata', () => {
        setLoading(false);
        video.play().catch(e => console.warn("Autoplay blocked", e));
      });
      video.addEventListener('error', handleMediaError);
    } else {
      setError("浏览器不支持 HLS 播放");
      setLoading(false);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }
    };
  }, [url]);

  return (
    <div className="fixed bottom-4 right-4 w-80 sm:w-96 bg-slate-900 border border-slate-700 shadow-2xl rounded-lg overflow-hidden z-50 flex flex-col animate-in slide-in-from-bottom-5 fade-in">
      <div className="bg-slate-800 p-2 flex justify-between items-center border-b border-slate-700">
        <h3 className="text-sm font-semibold text-slate-200 truncate pr-2">
          {name}
        </h3>
        <button 
          onClick={onClose}
          className="text-slate-400 hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>
      
      <div className="relative bg-black aspect-video flex items-center justify-center">
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/50">
            <RefreshCw className="animate-spin text-white" size={24} />
          </div>
        )}
        
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-slate-900/90 text-red-400 p-4 text-center">
            <AlertTriangle className="mb-2" size={24} />
            <p className="text-xs">{error}</p>
          </div>
        )}

        <video 
          ref={videoRef} 
          className="w-full h-full object-contain" 
          controls 
          autoPlay 
          muted={false}
        />
      </div>
      
      <div className="bg-slate-800 px-3 py-1.5 flex justify-between text-xs text-slate-400">
        <span>{resolution || 'Auto'}</span>
        <span>延迟: {latency ? `${latency}ms` : 'N/A'}</span>
      </div>
    </div>
  );
};

export default VideoPlayer;
