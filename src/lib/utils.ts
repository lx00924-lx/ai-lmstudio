import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length * 1.5);
}

export function formatMessageDate(date: Date | string): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  
  if (diff < oneDay && now.getDate() === d.getDate()) {
    return timeStr;
  } else if (diff < oneDay * 2 || (diff < oneDay * 3 && now.getDate() - d.getDate() === 1)) {
    // Check if it was actually yesterday
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (yesterday.getDate() === d.getDate()) {
      return `昨天 ${timeStr}`;
    }
  }
  
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  
  return `${year}-${month}-${day} ${timeStr}`;
}

export async function safeSaveToLocalStorage(key: string, value: any): Promise<boolean> {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    
    // Always attempt backup to filesystem if Capacitor is available
    if (typeof window !== 'undefined' && 'Capacitor' in window) {
      try {
        const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
        await Filesystem.writeFile({
          path: `data/${key}.json`,
          data: JSON.stringify(value),
          directory: Directory.Data,
          encoding: Encoding.UTF8,
          recursive: true,
        });
      } catch (fsErr) {
        console.error(`Filesystem backup error for key "${key}":`, fsErr);
      }
    }
    
    return true;
  } catch (err) {
    console.warn(`LocalStorage write failed for key "${key}", filesystem backup only.`);
    // Still attempt fallback to filesystem if localStorage.setItem fails
    try {
      if (typeof window !== 'undefined' && 'Capacitor' in window) {
        const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
        await Filesystem.writeFile({
          path: `data/${key}.json`,
          data: JSON.stringify(value),
          directory: Directory.Data,
          encoding: Encoding.UTF8,
          recursive: true,
        });
        console.log(`Successfully saved "${key}" to filesystem.`);
        return true;
      }
    } catch (fsErr) {
      console.error(`Filesystem save error for key "${key}":`, fsErr);
    }
    return false;
  }
}
