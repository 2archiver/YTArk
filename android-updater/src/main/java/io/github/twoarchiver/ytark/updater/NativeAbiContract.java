package io.github.twoarchiver.ytark.updater;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;

/**
 * Shared mapping between Android userspace ABIs and versioned YTArk assets.
 *
 * <p>YTArk publishes ARMv7 ({@code armeabi-v7a}) APKs only from 2.1.2 onwards.
 * ARM64 builds were published up to 2.1.1; they are never selected as an update
 * because an APK whose native code has another ABI cannot replace the running
 * one. A 64-bit CPU does not by itself mean the Android userspace can run
 * 32-bit native code — only Android's reported ABI list decides that.
 */
final class NativeAbiContract {
    static final String ARMV7_SUFFIX = "armv7";
    static final String ARMV7_ABI = "armeabi-v7a";
    /** ABI of installations that were never migrated off the dual-ABI releases. */
    static final String LEGACY_ARM64_ABI = "arm64-v8a";

    private NativeAbiContract() { }

    /**
     * Select the ARMv7 asset when Android reports 32-bit native support. The
     * check runs before any download, so an unsupported device gets one clear
     * message instead of an APK it cannot install.
     */
    static String assetSuffixForSupportedAbis(String[] supportedAbis) throws IOException {
        if (supportedAbis != null) {
            List<String> abis = Arrays.asList(supportedAbis);
            if (abis.contains(ARMV7_ABI)) return ARMV7_SUFFIX;
        }
        throw new IOException("This device cannot run the ARMv7-only YTArk releases: Android does "
                + "not report " + ARMV7_ABI + " in its ABI list. A 64-bit CPU does not by itself "
                + "mean the Android userspace supports 32-bit applications; check "
                + "ro.product.cpu.abilist on the device. Device ABIs: "
                + (supportedAbis == null ? "unknown" : Arrays.toString(supportedAbis)) + ".");
    }

    static String nativeAbiForSuffix(String suffix) throws IOException {
        if (ARMV7_SUFFIX.equals(suffix)) return ARMV7_ABI;
        throw new IOException("Unsupported YTArk architecture suffix: " + suffix
                + ". YTArk 2.1.2 and later publish " + ARMV7_SUFFIX + " (" + ARMV7_ABI + ") only.");
    }

    static String assetSuffixForNativeAbi(String abi) throws IOException {
        if (ARMV7_ABI.equals(abi)) return ARMV7_SUFFIX;
        if (LEGACY_ARM64_ABI.equals(abi)) {
            throw new IOException("This installation reports " + LEGACY_ARM64_ABI + "; YTArk 2.1.2 "
                    + "and later are published for " + ARMV7_ABI + " only, and cross-ABI updates are "
                    + "not supported. Install an ARMv7 build manually on a device whose Android "
                    + "userspace supports 32-bit native code.");
        }
        throw new IOException("Unsupported YTArk native ABI: " + abi + ". YTArk 2.1.2 and later "
                + "publish " + ARMV7_ABI + " only.");
    }

    /**
     * Updates stay on the ABI actually embedded in the installed APK, even when
     * the device also supports a higher-priority ABI. A 32-to-64-bit migration
     * needs explicit verification and is never selected implicitly.
     */
    static String assetSuffixForInstalledAbi(String installedAbi, String[] supportedAbis)
            throws IOException {
        String suffix = assetSuffixForNativeAbi(installedAbi);
        if (supportedAbis == null || !Arrays.asList(supportedAbis).contains(installedAbi)) {
            throw new IOException("The installed YTArk ABI is not supported by this Android userspace: "
                    + installedAbi + ". Reinstall a matching build manually before updating.");
        }
        return suffix;
    }
}
