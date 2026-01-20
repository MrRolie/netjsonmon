/**
 * Formatting utilities for CLI output
 * Handles byte sizes, truncation, number formatting
 */

/**
 * Format bytes to human-readable string (KB, MB, GB)
 */
export function formatBytes(bytes: number, decimals: number = 1): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Format number with thousands separator
 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - 1) + '…';
}

/**
 * Truncate array of strings and join
 */
export function truncateArray(items: string[], maxItems: number = 3, maxLength: number = 50): string {
  const displayed = items.slice(0, maxItems);
  const truncated = displayed.map(item => truncate(item, maxLength));
  
  if (items.length > maxItems) {
    return truncated.join(', ') + ` (+${items.length - maxItems} more)`;
  }
  
  return truncated.join(', ');
}

/**
 * Format a score as percentage
 */
export function formatScore(score: number): string {
  return (score * 100).toFixed(1) + '%';
}

/**
 * Format timestamp to human-readable date/time
 */
export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString();
}

/**
 * Format relative time (e.g., "2 seconds ago")
 */
export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Pad string to specified length
 */
export function pad(str: string, length: number, char: string = ' '): string {
  return str.padEnd(length, char);
}

/**
 * Center-align string within specified width
 */
export function center(str: string, width: number): string {
  if (str.length >= width) return str;
  const totalPadding = width - str.length;
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;
  return ' '.repeat(leftPadding) + str + ' '.repeat(rightPadding);
}
