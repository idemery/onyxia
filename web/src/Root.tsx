import { Suspense, lazy, useEffect } from "react";
import { useDarkMode, useSplashScreen } from "onyxia-ui";
import {
    OnyxiaUi,
    injectCustomFontFaceIfNotAlreadyDone,
    loadThemedFavicon
} from "ui/theme";
import { listenToEmbedderTheme } from "ui/theme/embedderTheme";

injectCustomFontFaceIfNotAlreadyDone();
loadThemedFavicon();

const App = lazy(() => import("ui/App"));

export function Root() {
    return (
        <OnyxiaUi>
            <EmbedderTheme />
            <Suspense fallback={<SplashScreen />}>
                <AppWrapper />
            </Suspense>
        </OnyxiaUi>
    );
}

/**
 * Framed, the app wears the embedding page's colour scheme (see embedderTheme). It
 * listens from the root, beside the splash screen, so the page's answer can land
 * before the app itself has finished loading.
 */
function EmbedderTheme() {
    const { setIsDarkModeEnabled } = useDarkMode();

    useEffect(
        () => listenToEmbedderTheme({ onIsDarkModeEnabled: setIsDarkModeEnabled }),
        [setIsDarkModeEnabled]
    );

    return null;
}

function AppWrapper() {
    const { hideRootSplashScreen } = useSplashScreen();

    useEffect(() => {
        hideRootSplashScreen();
    }, []);

    return <App />;
}

function SplashScreen() {
    const { showSplashScreen, hideSplashScreen, hideRootSplashScreen } =
        useSplashScreen();

    useEffect(() => {
        hideRootSplashScreen();
        showSplashScreen({ enableTransparency: false });

        return () => {
            hideSplashScreen();
        };
    }, []);

    return null;
}
