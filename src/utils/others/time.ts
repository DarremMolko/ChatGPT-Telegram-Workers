function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

function formatOffset(date: Date): string {
    const totalMinutes = -date.getTimezoneOffset();
    const sign = totalMinutes >= 0 ? '+' : '-';
    const absoluteMinutes = Math.abs(totalMinutes);
    const hours = Math.floor(absoluteMinutes / 60);
    const minutes = absoluteMinutes % 60;
    return `${sign}${pad2(hours)}:${pad2(minutes)}`;
}

export function getLocalDateKey(date: Date = new Date()): string {
    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    return `${year}-${month}-${day}`;
}

export function formatLocalDateTime(date: Date = new Date()): string {
    const year = date.getFullYear();
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());
    const hours = pad2(date.getHours());
    const minutes = pad2(date.getMinutes());
    const seconds = pad2(date.getSeconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${formatOffset(date)}`;
}
