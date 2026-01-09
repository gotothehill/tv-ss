import { PlaylistPreset } from './types';

export const PRESETS: PlaylistPreset[] = [
  {
    name: "Guovin/YuanHsing (推荐)",
    url: "https://raw.githubusercontent.com/YuanHsing/IPTV/main/IPTV.m3u",
    category: "China"
  },
  {
    name: "imDazui (大杂烩/超全)",
    url: "https://raw.githubusercontent.com/imDazui/Tvlist-awesome-m3u-m3u8/master/m3u/m3u8.m3u",
    category: "China"
  },
  {
    name: "Fanmingming IPv6 (最快)",
    url: "https://live.fanmingming.com/tv/m3u/ipv6.m3u",
    category: "China"
  },
  {
    name: "Fanmingming IPv4 (通用)",
    url: "https://live.fanmingming.com/tv/m3u/v6.m3u",
    category: "China"
  },
  {
    name: "YueChan 直播源",
    url: "https://raw.githubusercontent.com/YueChan/Live/main/IPTV.m3u",
    category: "China"
  },
  {
    name: "YanG-1989 (Global)",
    url: "https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u",
    category: "International"
  }
];

export const TIMEOUT_MS = 6000;
export const BATCH_SIZE = 12;