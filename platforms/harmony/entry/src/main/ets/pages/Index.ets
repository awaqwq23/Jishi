import { webview } from '@kit.ArkWeb';

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  private appUrl: string = 'http://127.0.0.1:3000'; // 发布时替换为记时的 HTTPS 地址

  build() {
    Column() {
      Web({ src: this.appUrl, controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .mixedMode(MixedMode.None)
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#f4f0e8')
  }
}
