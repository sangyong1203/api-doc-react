module.exports = {
  packagerConfig: {
    name: 'APIDOC',
    executableName: 'APIDOC',
    appBundleId: 'dev.apidoc.desktop',
    asar: true,
    // Renderer의 런타임 의존성은 Vite 결과물에 포함됩니다. 앱 실행에 필요한 파일만 패키징합니다.
    ignore: (filePath) => filePath !== '' && !/^\/(package\.json$|dist($|\/)|dist-electron($|\/))/.test(filePath.replaceAll('\\', '/')),
  },
  makers: [],
}
