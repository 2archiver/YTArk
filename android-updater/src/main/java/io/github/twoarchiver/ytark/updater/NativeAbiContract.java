package io.github.twoarchiver.ytark.updater;

import java.io.IOException;
import java.util.Arrays;
import java.util.List;

/** Shared mapping between Android userspace ABIs and versioned YTArk assets. */
final class NativeAbiContract {
    static final String ARM64_SUFFIX = "arm64";
    static final String ARMV7_SUFFIX = "armv7";
    static final String ARM64_ABI = "arm64-v8a";
    static final String ARMV7_ABI = "armeabi-v7a";

    private NativeAbiContract() { }

    /** Prefer arm64 when Android reports it; otherwise use a real ARMv7 asset. */
    static String assetSuffixForSupportedAbis(String[] supportedAbis) throws IOException {
        if (supportedAbis != null) {
            List<String> abis = Arrays.asList(supportedAbis);
            if (abis.contains(ARM64_ABI)) return ARM64_SUFFIX;
            if (abis.contains(ARMV7_ABI)) return ARMV7_SUFFIX;
        }
        throw new IOException("This device's Android userspace ABI is not supported by YTArk. "
                + "Available builds require arm64-v8a or armeabi-v7a; device ABIs: "
                + (supportedAbis == null ? "unknown" : Arrays.toString(supportedAbis)) + ".");
    }

    static String nativeAbiForSuffix(String suffix) throws IOException {
        if (ARM64_SUFFIX.equals(suffix)) return ARM64_ABI;
        if (ARMV7_SUFFIX.equals(suffix)) return ARMV7_ABI;
        throw new IOException("Unsupported YTArk architecture suffix: " + suffix);
    }

    static String assetSuffixForNativeAbi(String abi) throws IOException {
        if (ARM64_ABI.equals(abi)) return ARM64_SUFFIX;
        if (ARMV7_ABI.equals(abi)) return ARMV7_SUFFIX;
        throw new IOException("Unsupported YTArk native ABI: " + abi);
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
