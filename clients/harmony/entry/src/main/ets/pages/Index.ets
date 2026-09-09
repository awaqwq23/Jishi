import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { notificationManager } from '@kit.NotificationKit';
import { isTrustedJishiUrl } from './TrustedUrl';
import { ReminderScheduler } from './ReminderScheduler';

interface JishiNativeBridge {
  notify: (title: string, body: string, key: string) => string;
  requestNotificationPermission: () => string;
  notificationPermissionState: () => string;
  syncReminders: (payload: string) => void;
}

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  @State currentUrl: string = 'https://jishi.awaqwq233.com/';
  @State loadFailed: boolean = false;
  @State loading: boolean = true;
  private readonly primaryUrl: string = 'https://jishi.awaqwq233.com/';
  private readonly fallbackUrl: string = 'https://awaqwq233.com/note/';
  private scheduler: ReminderScheduler = new ReminderScheduler();
  private nativeBridge: JishiNativeBridge = {
    notify: (title: string, body: string, key: string): string => {
      if (!this.bridgeAllowed() || typeof title !== 'string' || typeof body !== 'string' || typeof key !== 'string') return 'rejected';
      const request: notificationManager.NotificationRequest = {
        id: this.notificationId(key),
        content: {
          notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: { title: title.slice(0, 120), text: body.slice(0, 500) }
        }
      };
      notificationManager.publish(request).catch(() => {});
      return 'queued';
    },
    requestNotificationPermission: (): string => {
      if (!this.bridgeAllowed()) return 'denied';
      const context = getContext(this) as common.UIAbilityContext;
      notificationManager.requestEnableNotification(context)
        .then(() => this.emitPermission('granted'))
        .catch(() => this.emitPermission('denied'));
      return 'prompting';
    },
    notificationPermissionState: (): string => {
      if (!this.bridgeAllowed()) return 'denied';
      return notificationManager.isNotificationEnabledSync() ? 'granted' : 'denied';
    },
    syncReminders: (payload: string): void => {
      if (!this.bridgeAllowed()) return;
      this.scheduler.sync(payload, () => {
        if (!this.bridgeAllowed()) return;
        this.controller.runJavaScript("window.dispatchEvent(new Event('jishi-native-reminders-unavailable')); ").catch(() => {});
      });
    }
  };

  private bridgeAllowed(): boolean {
    try { return !this.loadFailed && isTrustedJishiUrl(this.controller.getUrl()); }
    catch (_) { return false; }
  }

  onBackPress(): boolean {
    if (!this.loadFailed && this.controller.accessBackward()) {
      this.controller.backward();
      return true;
    }
    return false;
  }

  private notificationId(key: string): number {
    let value: number = 0;
    for (let index: number = 0; index < key.length; index++) {
      value = (value * 31 + key.charCodeAt(index)) & 0x7fffffff;
    }
    return value === 0 ? 1 : value;
  }

  private emitPermission(state: string): void {
    if (!this.bridgeAllowed()) return;
    this.controller.runJavaScript(
      `window.dispatchEvent(new CustomEvent('jishi-native-notification-permission',{detail:'${state}'}));`
    ).catch(() => {});
  }

  private failOver(): void {
    if (this.currentUrl === this.primaryUrl) {
      this.currentUrl = this.fallbackUrl;
      this.loadFailed = false;
      return;
    }
    this.loadFailed = true;
    this.loading = false;
  }

  private isTrustedUrl(url: string): boolean {
    return isTrustedJishiUrl(url);
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      Web({ src: this.currentUrl, controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .fileAccess(false)
        .mixedMode(MixedMode.None)
        .javaScriptProxy({
          object: this.nativeBridge,
          name: 'JishiNative',
          methodList: ['notify', 'requestNotificationPermission', 'notificationPermissionState', 'syncReminders'],
          controller: this.controller,
          permission: '{"javascriptProxyPermission":{"urlPermissionList":[{"scheme":"https","host":"jishi.awaqwq233.com","port":"443","path":"/"},{"scheme":"https","host":"awaqwq233.com","port":"443","path":"/note/"}]}}'
        })
        .onControllerAttached(() => {
          const userAgent: string = this.controller.getUserAgent();
          this.controller.setCustomUserAgent(`${userAgent} JishiHarmony/0.3.1`);
        })
        .onPageBegin(() => {
          this.loadFailed = false;
          this.loading = true;
        })
        .onPageEnd(() => { this.loading = false; })
        .onLoadIntercept((event) => {
          return !this.isTrustedUrl(event.data.getRequestUrl());
        })
        .onErrorReceive((event) => {
          if (event && event.request.isMainFrame()) this.failOver();
        })
        .onHttpErrorReceive((event) => {
          if (event && event.request.isMainFrame() && event.response.getResponseCode() >= 400) this.failOver();
        })
        .width('100%')
        .height('100%')

      if (this.loading && !this.loadFailed) {
        LoadingProgress().width(40).height(40).color('#9e8d74')
      }

      if (this.loadFailed) {
        Column({ space: 16 }) {
          Text('暂时无法连接记时')
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor('#45433f')
          Text('请检查网络后重试，也可以切换主站。')
            .fontSize(15)
            .fontColor('#736d64')
          Row({ space: 12 }) {
            Button('重试').onClick(() => {
              this.loadFailed = false;
              this.loading = true;
              this.controller.refresh();
            })
            Button('切换主站').onClick(() => {
              this.currentUrl = this.currentUrl === this.primaryUrl ? this.fallbackUrl : this.primaryUrl;
              this.loadFailed = false;
              this.loading = true;
            })
          }
        }
        .padding(28)
        .backgroundColor('#fffdf8')
        .borderRadius(20)
        .margin(24)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#f4f0e8')
  }
}
