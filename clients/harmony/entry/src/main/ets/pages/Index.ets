import { webview } from '@kit.ArkWeb';

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  private appUrl: string = 'https://jishi-todo.lym820288706.chatgpt.site';

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
