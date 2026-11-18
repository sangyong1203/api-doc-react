export type ExcelCell = {
  text?: unknown
  colspan?: number
  rowspan?: number
  link?: string
  style: Record<string, string | number | boolean>
}
export type ExcelSheet = { name: string; data: ExcelCell[][] }
declare const Excel: { make: (sheets: ExcelSheet[], fileName: string) => Promise<void> }
export default Excel
