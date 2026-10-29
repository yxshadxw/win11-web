export function formatDuration(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
}
export function alarmDue(alarm, date) {
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return alarm.enabled && alarm.time === time && (!alarm.days.length || alarm.days.includes(date.getDay()));
}
export function lapStats(laps) {
  return { best: Math.min(...laps), worst: Math.max(...laps) };
}
