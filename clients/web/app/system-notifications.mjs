// A queued native call is not a delivery receipt. Harmony reports publish results
// asynchronously; Electron returns a promise, and older Android bridges return void.
export async function sendNativeNotification(native, title, body, key, target = window, timeout = 8000) {
  let timer;
  let receive;
  const receipt = new Promise((resolve, reject) => {
    receive = event => {
      if (event.detail?.key !== key) return;
      if (event.detail.state === 'sent') resolve();
      else reject(new Error('系统通知发送失败，请检查系统通知设置'));
    };
    target.addEventListener('jishi-native-notification-result', receive);
    timer = setTimeout(() => reject(new Error('未收到系统通知发送结果，请检查权限或更新客户端')), timeout);
  });
  // Older bridges have no receipt event; attach a handler before calling them.
  receipt.catch(() => {});
  try {
    const result = await native.notify(title, body, key);
    if (result === 'rejected' || result === false) throw new Error('系统通知被拒绝，请检查通知权限');
    const hasReceipts = native.notificationDeliveryReceipts?.() === 'supported';
    if (result === 'queued' && hasReceipts) await receipt;
    return result === 'sent' || result === true || (result === 'queued' && hasReceipts);
  } finally {
    clearTimeout(timer);
    target.removeEventListener('jishi-native-notification-result', receive);
  }
}
