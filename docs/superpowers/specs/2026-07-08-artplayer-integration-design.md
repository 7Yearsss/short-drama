# ArtPlayer 接入设计

## 背景

短剧详情页 `apps/web/app/series/[id]/page.tsx` 当前用原生 `<video controls autoPlay src={playbackUrl} />` 播放单一 MP4(R2 signed URL,300 秒有效期,见 `apps/api/src/lib/r2.ts`)。锁定提示是播放器下方一张独立的 `unlock-card`。这次只做播放器本身的升级,不做 HLS/多清晰度转码,也不涉及 Cloudflare Worker——这些留到后续单独评估。

## 目标

用 [ArtPlayer](https://github.com/zhw2590582/ArtPlayer) 替换原生 `<video>`,把"锁定/登录解锁"提示挪进播放器内部做成 layer 遮罩,并支持播完自动播放下一集(可关闭)。播放的仍是同一个单一 MP4 signed URL,后端播放权限判定逻辑(`apps/api/src/routes/playback.ts`)完全不改。

## 架构

新增 `apps/web/components/PlayerStage.tsx`,替换 `page.tsx` 里 `player-stage` div 的全部内容(原生 video + placeholder + 下方 unlock-card)。对外接口:

```tsx
interface PlayerStageProps {
  coverUrl: string | null;
  playbackUrl: string | null; // null = 还没播放或被锁定
  locked: boolean;
  onRequestPlay: () => void;  // 点击大播放键 → 父组件 fetchPlaybackUrl(firstEpisode)
  onRequestLogin: () => void; // 锁定层里的"LINE 登录"
  onEnded: () => void;        // 一集播完 → 父组件 play(nextEpisode)
}
```

`page.tsx` 只传状态和三个回调,不感知 ArtPlayer 内部细节;`play()`、锁定判断、选集逻辑都不用改。

组件内部只维护**一个** ArtPlayer 实例(不按状态销毁重建),通过 `art.layers.add/remove` 在挂载期间动态切换三种视觉状态:

1. **未播放**(`playbackUrl === null && !locked`):poster 用 `coverUrl`,叠一个 `click` layer 覆盖整个区域,点击触发 `onRequestPlay`。
2. **锁定**(`locked === true`):poster 不变,叠一个 `html` layer,内容是现在 `unlock-card` 的文案 +「LINE 登录」/「去解锁」两个按钮(挪进播放器内部,不再单独在下方展示)。
3. **正常播放**(`playbackUrl` 有值):调用 ArtPlayer 的 `switchUrl`/`url` 更新播放地址,移除上述 layer,走正常播放控件。

## 自动连播

用 ArtPlayer 自带的 `setting` 面板加一个自定义开关项,状态存 `localStorage`(key: `autoNextEpisode`,默认 `true`):

```ts
settings: [
  {
    html: '自动连播',
    switch: getAutoNextPref(),
    onSwitch(item) {
      const next = !item.switch;
      setAutoNextPref(next);
      item.switch = next;
      return next;
    },
  },
],
```

`art.on('video:ended', ...)` 读同一个偏好:开启则调用 `onEnded()`(父组件 `play(nextEpisode)`——如果下一集被锁,会自然落到锁定状态,在播放器内弹锁定层,不会黑屏或跳出页面);关闭则停在结束画面,不做任何事。

## 样式 & 接入细节

- `apps/web` 新增依赖 `artplayer`。
- ArtPlayer 挂载进现有 `.player-stage` 容器(9:16、`max-width: 360px`、`max-height: 640px` 约束不变),配置 `fullscreen: true`、`autoSize: false`,避免 ArtPlayer 自己接管容器尺寸。
- 删除 `.player-placeholder`、`.player-play-trigger`、`.player-big-play`、`.unlock-card` 这几条 CSS 规则(职责被 poster + layer 取代),新增锁定层按钮的 CSS(视觉照搬现有 `.unlock-card`)。
- 登录逻辑不变,仍调用 `mockLineLogin()`。
- 不引入 `hls.js` 或 `artplayer-plugin-hls-control`(这次不做多清晰度/HLS)。

## 不做的事

- HLS 多码率转码、清晰度切换菜单
- Cloudflare Worker token 校验/防盗链增强
- 自动化 UI 测试(ArtPlayer 是重 DOM/Canvas 交互库,这次不新增自动化测试)

## 验证方式

改完后本地 `pnpm dev` 跑一遍手动验证清单:
- 点封面大播放键能正常播放第一集
- 切到被锁定的集数,播放器内弹出锁定 layer(含登录/解锁按钮),下方不再有独立 unlock-card
- 一集播完,自动连播开启时自动播放下一集(含"下一集被锁"场景的锁定层展示)
- 关闭自动连播开关后,播完停在结束画面,不自动跳转
