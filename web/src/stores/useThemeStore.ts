import { create } from 'zustand';
import { STORAGE_KEY_THEME } from '@/utils/constants';
import { obfuscatedStorage } from '@/services/storage/secureStorage';

export const useThemeStore = create<{ resolvedTheme: 'light' | 'dark' }>(() => ({
  resolvedTheme: 'light',
}));

export function followPanelTheme() {
  const media = matchMedia('(prefers-color-scheme: dark)');
  let parent: HTMLElement | undefined;
  try {
    if (window.parent !== window) parent = window.parent.document.documentElement;
  } catch {
    // A cross-origin iframe can still follow the system theme.
  }

  const sync = () => {
    let theme = parent?.dataset.themeMode || parent?.dataset.theme;
    if (!theme && parent && window.frameElement) {
      const scheme = window.parent.getComputedStyle(window.frameElement).colorScheme;
      if (scheme === 'light' || scheme === 'dark') theme = scheme;
    }
    if (!theme && !parent) {
      try {
        theme = obfuscatedStorage.getItem<{ state: { theme: string } }>(STORAGE_KEY_THEME)?.state?.theme;
      } catch {
        // Storage can be blocked in embedded pages.
      }
    }
    if (!theme || theme === 'auto') theme = media.matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    useThemeStore.setState({ resolvedTheme: theme === 'dark' ? 'dark' : 'light' });
  };

  if (parent) {
    new MutationObserver(sync).observe(parent, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-theme-mode'],
    });
  }
  media.addEventListener('change', sync);
  sync();
}
