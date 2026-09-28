/* eslint-disable react-refresh/only-export-components */
import {
    createOnyxiaUi,
    defaultGetTypographyDesc,
    defaultSpacingConfig,
    defaultGetIconSizeInPx
} from "onyxia-ui";
import { getPalette } from "./palette";
import { env } from "env";
import { loadThemedFavicon as loadThemedFavicon_base } from "./loadThemedFavicon";
import { Evt } from "evt";
import { CacheProvider } from "@emotion/react";
import { pluginSystemInitTheme } from "pluginSystem";
import { targetWindowInnerWidth } from "ui/theme/targetWindowInnerWidth";
import { isStorybook } from "ui/tools/isStorybook";
import { css, cx, emotionCache } from "./emotionCache";

/**
 * COMPACT_TYPOGRAPHY — sized for a window on a desktop rather than a 1980px page.
 *
 * The root font size is what onyxia-ui derives spacing and icon sizes from as well,
 * so lowering it scales the whole app together. The body and label sizes keep their
 * proportions (body 1 lands on 14px); the headings are pulled in explicitly, because
 * at 14px the default page heading would still be 31.5px — a poster inside a window.
 */
const isCompactTypography = import.meta.env.COMPACT_TYPOGRAPHY === "true";
const COMPACT_ROOT_FONT_SIZE_PX = 14;
const COMPACT_HEADINGS_REM = {
    "display heading": { fontSizeRem: 1.6, lineHeightRem: 2 },
    "page heading": { fontSizeRem: 1.25, lineHeightRem: 1.6 },
    subtitle: { fontSizeRem: 1.1, lineHeightRem: 1.5 },
    "section heading": { fontSizeRem: 1.1, lineHeightRem: 1.5 },
    "object heading": { fontSizeRem: 1, lineHeightRem: 1.4 },
    "navigation label": { fontSizeRem: 1, lineHeightRem: 1.4 }
} as const;

const {
    OnyxiaUi: OnyxiaUiWithoutEmotionCache,
    evtTheme,
    ofTypeTheme
} = createOnyxiaUi({
    getTypographyDesc: params => {
        const desc = defaultGetTypographyDesc({
            ...params,
            // We don't want the font to be responsive
            // By default, the font size change depending on the screen size,
            // we don't want that here so we fix the windowInnerWidth.
            windowInnerWidth: targetWindowInnerWidth,
            ...(isCompactTypography ? { rootFontSizePx: COMPACT_ROOT_FONT_SIZE_PX } : {})
        });
        return {
            ...desc,
            ...(isCompactTypography
                ? {
                      variants: Object.fromEntries(
                          Object.entries(desc.variants).map(([name, variant]) => [
                              name,
                              name in COMPACT_HEADINGS_REM
                                  ? {
                                        ...variant,
                                        ...COMPACT_HEADINGS_REM[
                                            name as keyof typeof COMPACT_HEADINGS_REM
                                        ]
                                    }
                                  : variant
                          ])
                      ) as typeof desc.variants
                  }
                : {}),
            fontFamily: `'${env.FONT.fontFamily}'`
        };
    },
    palette: getPalette,
    splashScreenParams: isStorybook
        ? undefined
        : {
              assetUrl: env.SPLASHSCREEN_LOGO,
              assetScaleFactor: env.SPLASHSCREEN_LOGO_SCALE_FACTOR,
              minimumDisplayDuration: 0
          },
    getIconSizeInPx: params =>
        defaultGetIconSizeInPx({ ...params, windowInnerWidth: targetWindowInnerWidth }),
    spacingConfig: params =>
        defaultSpacingConfig({
            ...params,
            windowInnerWidth: targetWindowInnerWidth
        })
});

export { evtTheme };

pluginSystemInitTheme({
    evtTheme: Evt.loosenType(evtTheme),
    css,
    cx
});

export function OnyxiaUi(props: { children: React.ReactNode; darkMode?: boolean }) {
    const { children, darkMode } = props;
    return (
        <CacheProvider value={emotionCache}>
            <OnyxiaUiWithoutEmotionCache darkMode={darkMode ?? env.DARK_MODE}>
                {children}
            </OnyxiaUiWithoutEmotionCache>
        </CacheProvider>
    );
}

export type Theme = typeof ofTypeTheme;

export const loadThemedFavicon = () =>
    loadThemedFavicon_base({ evtTheme: Evt.loosenType(evtTheme) });
