import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Home-screen icons from public/favicon.svg: `npx pwa-assets-generator`. The icons that phones crop
// (Android's maskable, iOS's touch icon) sit on the brand colour instead of white.

const background = '#5B4CF0';

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background } },
  },
  images: ['public/favicon.svg'],
});
