# 应用图标与软件包一致性

2026-10-11 使用内置 imagegen 生成，以原横幅为风格参考，导出正方形图标；没有使用 API / CLI fallback。

商店上传文件：`releases/current/Jishi-Harmony-Icon-1024.png`，1024×1024、不透明 PNG、1933197 字节，小于 3 MB。它与源码 `entry/src/main/resources/base/media/app_icon.png` 的文件字节相同。

鸿蒙 0.3.4（3000004）已使用这份源码资源重建并正式签名。实际从 APP 内 HAP 提取图标确认，同为纸质清单、橙色勾选和绿叶图案。官方资源编译器会将启动图标压缩为 512×512，因此编译后的文件字节与原 1024 文件不同；不能声称二者字节完全相同。归一化到相同尺寸后的像素平均通道差异约 1.09 / 255、PSNR 43.57 dB，已同时进行实际图片视觉检查。校验信息保存在 `releases/current/harmony-icon.json`。

上传时同时使用新图标和 `Jishi-Harmony-0.3.4.app`。不要将新图标与旧 0.3.2 软件包搭配。满足已核验的尺寸、格式和大小要求不代表商店审核已经通过；尚未上传新图标 / 新包或进行真机安装验收。

参考：[华为视觉素材规格](https://developer.huawei.com/consumer/es/doc/app/agc-help-app-visual-asset-spec-0000002277607976)、[启动图标编译为 512 像素的官方说明](https://developer.huawei.com/consumer/cn/doc/doccenter-dev-faq/faqs-arkui-1149)。

## 生成提示词

Use case: style-transfer / logo-brand. Create ONE polished square application icon for 记时 (Jishi), a personal to-do, daily habits, check-in and reward-points application. Use the supplied image ONLY as the visual style and palette reference: warm ivory handmade paper, terracotta orange, muted sage green, gentle tactile relief and soft warm shadows. Redesign the wide banner into a genuine square icon, NOT a crop of the banner. Deliver exactly 1024 x 1024 pixels, opaque PNG, square full-bleed background with no transparent or rounded outside corners. Main subject: one large upright ivory checklist card centered in the square, softly rounded card corners, a prominent terracotta orange circular checkmark near its upper area, two simple bold muted-sage horizontal task strokes below, and a restrained small sage leaf motif integrated into the card at lower right. The mark should be balanced and recognizable at 48px, occupying around 70% of the square, with enough padding for system icon masks. Calm refined paper stationery aesthetic matching the reference. Use minimal clean forms and subtle paper texture, good contrast, no excessive props or details. No Chinese characters, text, app name, slogan, numbers, watermark, store badges, screenshot frame, device mockup, surrounding desk, photo scenery or shadow outside the square. This is the final icon file itself, not a presentation board.

2026-10-12：新名称拾光记事，新增应用级图标资源并保持入口图标、启动图标和网页图标一致；SDK 编译后资源已解包验证。
