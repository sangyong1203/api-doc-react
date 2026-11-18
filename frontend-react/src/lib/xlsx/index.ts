import Excel from './Excel.module.js'

/**
 * 데티어 테이블 리스트 데이터로 엑셀생성
 * @param downloadData Array  데이터 테이블 리스트
 * @param title String 엑셀 테이블의 헤더 타이틀. ''빈값을 줄때는 sheet에 타이틀이 나타나지 안는다.
 * @param tableHeaders String 각 컬럼 명 설정 string 배열 형식, 예: ['사용자명', '사용자아이디', '등록일', '수정일']
 * @param fileName String 엑셀파일 명
 * @example
 * 예: makeExcelAndDownload(tableData, '사용자목록',  ['사용자명', '사용자아이디', '등록일', '수정일'],  '사용자목록엑셀파일')
 */
export const makeExcelAndDownload = (downloadData:Record<string, unknown>[], title:string, tableHeaders: string[], fileName: string) => {

    // --------------sheet style ---------------------
    const columStyle = { // 마지막 빈 컬럼 hiden
        height: 24,
        width: 1,
    }
    const titleStyle = {
        verticalAlign: 'middle',
        textAlign: 'center',
        backgroundColor: '#c1daf2',
        fontSize: 18,
        fontWeight: 'bold',
        border: '1px solid #000000',
        height: 24,
    }
    const tableHeader = {
        textAlign: 'center',
        border: '1px solid #000000',
        verticalAlign: 'middle',
        backgroundColor: '#f1f1f1',
        fontWeight: 'bold',
        fontSize: 10,
    }
    const indexNumber = {
        textAlign: 'center',
        border: '1px solid #000000',
        verticalAlign: 'middle',
        fontSize: 10,
        width: 30
    }
    const tableListStyle = {
        textAlign: 'center',
        border: '1px solid #000000',
        verticalAlign: 'middle',
        fontSize: 10,
        width: 140,
        height: 24,
    }
    //-------------------------------------

    // sheet table에 컬럼 해더 명 데이터 생성
    const tableHeaderList: import('./Excel.module.js').ExcelCell[] = []
    makeHeaderRow(tableHeaders)
    function makeHeaderRow(headers: string[]){
        tableHeaderList.push({
            text: 'NO',
            style: Object.assign({},tableHeader, {width:20}),
        })
        headers.forEach(name => {
            const item =  {
                text: name,
                style: Object.assign({},tableHeader),
            }
            tableHeaderList.push(item)
        })
    }
    // sheet 기본 데이터 생성
    const sheet1 = {
        name: 'Sheet1',
        data: [ tableHeaderList ], // 컬럼 해더
    }
    // title에 값이 있으면 테이블 컬럼 해더 행 위에 타이틀 추가
    if(title){
        sheet1.data.unshift([{ style: columStyle }])
        sheet1.data.unshift(
            [
                {
                    text: title,
                    colspan: tableHeaderList.length,
                    rowspan: 2,
                    style: Object.assign({},titleStyle),
                },
                { style: columStyle }
            ]
        )
    }
    // 데이터 리스트 추가
    for (let i = 0; i < downloadData.length; i++) {
            const keys = Object.keys(downloadData[i])
            const row = []

            row.push({
                text: i + 1,
                style: Object.assign({},indexNumber),
            })
            keys.forEach( keyName => {
                const item = {
                    text: downloadData[i][keyName],
                    style: Object.assign({},tableListStyle),
                }
                row.push(item)
            } )

            sheet1.data.push(row)
    }

    return Excel.make([sheet1], (fileName??('downloadExcel'+ new Date().toLocaleDateString('sv-SE'))) )
}
