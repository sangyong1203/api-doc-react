/* eslint-disable no-empty */
/************************************************
 * Excel.module.js
 * Created at 2021. 8. 25. 오후 2:59:40.
 *
 * @author soohongkim
 ************************************************/

/** style
  color?: CSSStyleDeclaration["color"],
  background?: CSSStyleDeclaration["background"],
  backgroundColor?: CSSStyleDeclaration["backgroundColor"],
  textAlign?: CSSStyleDeclaration["textAlign"],
  border?: CSSStyleDeclaration["border"],
  borderTop?: CSSStyleDeclaration["borderTop"],
  borderRight?: CSSStyleDeclaration["borderRight"],
  borderLeft?: CSSStyleDeclaration["borderLeft"],
  borderBottom?: CSSStyleDeclaration["borderBottom"],
  verticalAlign?: CSSStyleDeclaration["verticalAlign"],
  width?: number | 'auto',
  height?: number | 'auto',
  fontSize?: number,
  fontWeight?: 'normal' | 'bold',
  underline?: true | false
  whiteSpace: 'nowrap' | 'normal'
*/

let Excel = {}
Excel.make = async function (sheetArr, fileName) {
    await import('./XLSX.min.js')
    const XLSX = window.XLSX
    let wb = XLSX.utils.book_new()
    wb.Props = {
        Title: fileName,
        Subject: fileName,
        Author: 'Dev.monter',
        CreatedDate: new Date(),
    }


    sheetArr.forEach(function (sheet) {
        //each sheet

        let sheet_width = 0
        let sheet_height = sheet.data.length
        let ws = {}
        let merge_data = []
        sheet.data.forEach(function (row, ri) {
            let cur_ri = ri
            let cur_ci = -1
            row.forEach(function (col) {
                cur_ci++
                for (let mi = 0; mi < merge_data.length; mi++) {
                    let merge = merge_data[mi]
                    if (merge.s.c <= cur_ci && cur_ci <= merge.e.c && merge.s.r <= cur_ri && cur_ri <= merge.e.r) {
                        cur_ci += merge.e.c - cur_ci + 1
                    }
                }
                // 열 번호는 Excel 주소로 변환하여 AZ 이후에도 유효한 주소를 생성합니다.
                let cr = XLSX.utils.encode_col(cur_ci) + String(cur_ri + 1)
                if (!ws[cr]) {
                    ws[cr] = {
                        t: 's',
                        v: String(col.text ?? ''),
                        s: {
                            alignment: {
                                wrapText: true,
                            },
                        },
                    }
                }
                // 빈 링크 객체는 잘못된 빈 hyperlinks 요소를 만들므로 실제 링크만 기록합니다.
                if (typeof col.link === 'string' && col.link.trim()) {
                    ws[cr].l = { Target: col.link.trim() }
                }

                if (col.img) {
                    if (!ws['!images']) ws['!images'] = []
                    ws['!images'].push({
                        '!link': col.img.src,
                        '!pos': {
                            c: cur_ci,
                            r: cur_ri,
                            x: col.img.left,
                            y: col.img.top,
                            w: col.img.width,
                            h: col.img.height,
                        },
                        '!datatype': 'remote',
                    })
                }

                for (let styleKey in col.style) {
                    switch (styleKey) {
                        case 'backgroundColor':
                            ws[cr].s['fgColor'] = { rgb: col.style[styleKey].replace('#', '').toUpperCase() }
                            ws[cr].s.patternType = 'solid'
                            break
                        case 'border':
                            var border_arr = col.style[styleKey].split(' ')
                            var borderWidth
                            var borderColor = border_arr[2].replace('#', '')
                            if (border_arr[0] === '1px') {
                                borderWidth = 'thin'
                            } else if (border_arr[0] === '2px') {
                                borderWidth = 'medium'
                            } else {
                                borderWidth = 'thick'
                            }
                            col.colspan = col.colspan || 1
                            col.rowspan = col.rowspan || 1
                            for (let x = 0; x < col.colspan; x++) {
                                let index_ci = cur_ci + x
                                let merged_cr = XLSX.utils.encode_col(index_ci) + String(cur_ri + 1)
                                // 병합 영역의 테두리용 셀에는 표시할 값이 없습니다.
                                if (!ws[merged_cr]) ws[merged_cr] = { t: 's', s: {}, v: '' }
                                ws[merged_cr].s['top'] = { style: borderWidth, color: { rgb: borderColor } }
                                ws[merged_cr].s['bottom'] = { style: borderWidth, color: { rgb: borderColor } }
                                ws[merged_cr].s['left'] = { style: borderWidth, color: { rgb: borderColor } }
                                ws[merged_cr].s['right'] = { style: borderWidth, color: { rgb: borderColor } }
                                if (sheet_width < index_ci) sheet_width = index_ci
                                for (let y = 0; y < col.rowspan; y++) {
                                    let index_ri = cur_ri + 1 + y
                                    let merged_cr = XLSX.utils.encode_col(index_ci) + String(index_ri)
                                    if (!ws[merged_cr]) ws[merged_cr] = { t: 's', s: {}, v: '' }
                                    ws[merged_cr].s['top'] = { style: borderWidth, color: { rgb: borderColor } }
                                    ws[merged_cr].s['bottom'] = { style: borderWidth, color: { rgb: borderColor } }
                                    ws[merged_cr].s['left'] = { style: borderWidth, color: { rgb: borderColor } }
                                    ws[merged_cr].s['right'] = { style: borderWidth, color: { rgb: borderColor } }
                                    if (sheet_height < cur_ri + 1 + y) sheet_height = cur_ri + 1 + y
                                }
                            }
                            break
                        case 'borderTop':
                        case 'borderLeft':
                        case 'borderBottom':
                        case 'borderRight':
                            var side = ''
                            if (styleKey === 'borderTop') side = 'top'
                            else if (styleKey === 'borderLeft') side = 'left'
                            else if (styleKey === 'borderBottom') side = 'bottom'
                            else if (styleKey === 'borderRight') side = 'right'
                            var borderSide_arr = col.style[styleKey].split(' ')
                            var borderSideWidth
                            var borderSideColor = borderSide_arr[2].replace('#', '')
                            if (borderSide_arr[0] === '1px') {
                                borderSideWidth = 'thin'
                            } else if (borderSide_arr[0] === '2px') {
                                borderSideWidth = 'medium'
                            } else {
                                borderSideWidth = 'thick'
                            }
                            ws[cr].s[side] = { style: borderSideWidth, color: { rgb: borderSideColor } }
                            if (styleKey === 'borderTop' || styleKey === 'borderBottom') {
                                for (let x = 1; x < col.colspan; x++) {
                                    let merged_cr = XLSX.utils.encode_col(cur_ci + x) + String(cur_ri + 1)
                                    if (!ws[merged_cr]) ws[merged_cr] = { t: 's', s: {}, v: '', z: 'General' }
                                    ws[merged_cr].s[side] = { style: borderSideWidth, color: { rgb: borderSideColor } }
                                }
                            }
                            if (styleKey === 'borderLeft' || styleKey === 'borderRight') {
                                for (let y = 1; y < col.rowspan; y++) {
                                    let merged_cr = XLSX.utils.encode_col(cur_ci) + String(cur_ri + 1 + y)
                                    if (!ws[merged_cr]) ws[merged_cr] = { t: 's', s: {}, v: '', z: 'General' }
                                    ws[merged_cr].s[side] = { style: borderSideWidth, color: { rgb: borderSideColor } }
                                }
                            }
                            break
                        case 'textAlign':
                            if (!ws[cr].s['alignment']) ws[cr].s['alignment'] = {}
                            ws[cr].s['alignment']['horizontal'] = col.style[styleKey]
                            break
                        case 'verticalAlign':
                            if (!ws[cr].s['alignment']) ws[cr].s['alignment'] = {}
                            switch (col.style[styleKey]) {
                                case 'middle':
                                    ws[cr].s['alignment']['vertical'] = 'center'
                                    break
                                default:
                                    ws[cr].s['alignment']['vertical'] = col.style[styleKey]
                                    break
                            }
                            break
                        case 'width':
                            if (!ws['!cols']) ws['!cols'] = []
                            if (typeof col.style[styleKey] === 'number')
                                ws['!cols'][cur_ci] = { wpx: col.style[styleKey] }
                            else if (col.style[styleKey] === 'auto') ws['!cols'][cur_ci] = { auto: 1 }
                            break
                        case 'height':
                            if (!ws['!rows']) ws['!rows'] = []
                            if (typeof col.style[styleKey] === 'number')
                                ws['!rows'][cur_ri] = { hpx: col.style[styleKey] }
                            else if (col.style[styleKey] === 'auto') ws['!rows'][cur_ri] = { auto: 1 }
                            break
                        case 'fontSize':
                            ws[cr].s.sz = col.style[styleKey]
                            break
                        case 'underline':
                            ws[cr].s['underline'] = col.style[styleKey]
                            break
                        case 'color':
                            ws[cr].s.color = { rgb: col.style[styleKey].replace('#', '').toUpperCase() }

                            break
                        case 'fontFamily':
                            ws[cr].s.name = col.style[styleKey]
                            break
                        case 'fontWeight':
                            if (col.style[styleKey] === 'bold') {
                                ws[cr].s.bold = 1
                            } else {
                            }
                            break
                        case 'whiteSpace':
                            if (col.style[styleKey] === 'nowrap') {
                                ws[cr].s.alignment.wrapText = false
                            }
                            break
                    }
                }
                if (col.colspan > 1 || col.rowspan > 1) {
                    let s = { c: cur_ci, r: cur_ri }
                    let e = {
                        c: col.colspan ? cur_ci + col.colspan - 1 : cur_ci,
                        r: col.rowspan ? cur_ri + col.rowspan - 1 : cur_ri,
                    }
                    // 병합 영역의 빈 셀에도 배경·글꼴·정렬을 적용합니다.
                    // 각 셀의 테두리는 앞서 계산한 위치별 설정을 유지합니다.
                    for (let r = s.r; r <= e.r; r++) {
                        for (let c = s.c; c <= e.c; c++) {
                            const address = XLSX.utils.encode_cell({ r, c })
                            if (!ws[address]) ws[address] = { t: 's', v: '', s: {} }
                            for (const key of Object.keys(ws[cr].s)) {
                                if (['top', 'bottom', 'left', 'right', 'diagonal'].includes(key)) continue
                                ws[address].s[key] = structuredClone(ws[cr].s[key])
                            }
                        }
                    }
                    merge_data.push({ s, e })
                    sheet_width = Math.max(sheet_width, e.c)
                    sheet_height = Math.max(sheet_height, e.r + 1)
                }
            })
            if (sheet_width < cur_ci) sheet_width = cur_ci
        })
        let ref = `A1:${XLSX.utils.encode_col(sheet_width)}${sheet_height}`
        ws['!ref'] = ref
        ws['!merges'] = merge_data
        //console.log(ws);
        wb.SheetNames.push(sheet.name)
        wb.Sheets[sheet.name] = ws
    })
    XLSX.writeFile(wb, fileName + '.xlsx', { cellStyles: true, bookImages: true, bookSST: false })
}

export default Excel
