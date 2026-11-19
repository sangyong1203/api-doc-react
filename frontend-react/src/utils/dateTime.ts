/** ISO 날짜 문자열·Date·밀리초 타임스탬프를 로컬 시간의 YYYY-MM-DD HH:mm:ss로 표시합니다. 유효하지 않은 값은 '-'로 표시합니다. */
export function formatDateTime(value: string | number | Date): string {
  const date = new Date(value instanceof Date ? value.getTime() : value)
  if (Number.isNaN(date.getTime())) { return '-' }

  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}
