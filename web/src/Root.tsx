import { Suspense, lazy, useEffect } from "react";
import { useDarkMode, useSplashScreen } from "onyxia-ui";
import {
    OnyxiaUi,
    injectCustomFontFaceIfNotAlreadyDone,
    loadThemedFavicon
} from "ui/theme";
import { listenToEmbedderTheme } from "ui/theme/embedderTheme";
import { listenToEmbedderPutObjects } from "ui/shared/codex/S3ExplorerMainView/embedderPutObjectsBridge";

injectCustomFontFaceIfNotAlreadyDone();
loadThemedFavicon();

const App = lazy(() => import("ui/App"));

export function Root() {
    return (
        <OnyxiaUi>
            <EmbedderTheme />
            <EmbedderPutObjects />
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

/**
 * Framed, the app uploads files the embedding page took a drop of over it (see
 * embedderPutObjectsBridge). It listens from the root rather than from the
 * explorer, so that a drop is answered whatever the app is showing: by the
 * explorer when it lists a folder, and with the reason when nothing does.
 */
function EmbedderPutObjects() {
    useEffect(() => listenToEmbedderPutObjects(), []);

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
