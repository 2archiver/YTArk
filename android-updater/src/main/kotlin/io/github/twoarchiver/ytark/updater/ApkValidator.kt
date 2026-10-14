package io.github.twoarchiver.ytark.updater

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import com.android.apksig.ApkVerifier
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.zip.CRC32
import java.util.zip.ZipFile

@Suppress("DEPRECATION")
class ApkValidator(private val context: Context) {
    fun installed(): PackageInfo = context.packageManager.getPackageInfo(context.packageName, flags())
    fun code(p: PackageInfo): Long = if(Build.VERSION.SDK_INT >= 28) p.longVersionCode else p.versionCode.toLong()
    private fun flags() = if(Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    private fun signers(p: PackageInfo): Set<String> = if(Build.VERSION.SDK_INT >= 28) p.signingInfo?.apkContentsSigners?.map { sha(it.toByteArray()) }?.toSet() ?: emptySet() else p.signatures?.map { sha(it.toByteArray()) }?.toSet() ?: emptySet()
    fun requireDevice() {
        NativeAbiContract.assetSuffixForSupportedAbis(Build.SUPPORTED_ABIS)
        ZipFile(context.applicationInfo.sourceDir).use { zip ->
            requireUpdate(zip.getEntry("lib/armeabi-v7a/libchrobalt.so") != null && zip.getEntry("lib/arm64-v8a/libchrobalt.so") == null,"Installed native payload is not ARMv7. Cross-ABI updates are not supported.")
        }
    }
    fun validate(file: File, candidate: Candidate) {
        requireDevice()
        requireUpdate(file.length() == candidate.size,"Incomplete APK; retry download.")
        val digest=MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input -> val buf=ByteArray(65536); while(true) { val n=input.read(buf); if(n<0) break; digest.update(buf,0,n) } }
        requireUpdate(hex(digest.digest()) == candidate.sha256,"APK checksum failed; retry download.")
        ZipFile(file).use { zip ->
            val entries=zip.entries(); val seen=HashSet<String>(); var unpacked=0L
            while(entries.hasMoreElements()) {
                val entry=entries.nextElement()
                requireUpdate(seen.add(entry.name),"Duplicate APK entry.")
                if(entry.isDirectory) continue
                requireUpdate(entry.size in 0..1024L*1024*1024,"Invalid APK entry size.")
                val crc=CRC32(); var size=0L
                zip.getInputStream(entry).use { input -> val buf=ByteArray(65536); while(true) { val n=input.read(buf); if(n<0) break; size+=n; unpacked+=n; requireUpdate(unpacked<=1536L*1024*1024,"APK archive exceeds limits."); crc.update(buf,0,n) } }
                requireUpdate(size==entry.size && crc.value==entry.crc,"Corrupt APK archive.")
            }
            requireUpdate("AndroidManifest.xml" in seen && "classes.dex" in seen && "lib/armeabi-v7a/libchrobalt.so" in seen,"APK lacks required ARMv7 application payload.")
            requireUpdate(seen.none { it.startsWith("lib/") && !it.startsWith("lib/armeabi-v7a/") },"APK contains a different ABI.")
        }
        // Independently verify APK cryptographic signatures. PackageManager certificate
        // extraction and a published SHA-256 are not substitutes for this step.
        val signed = ApkVerifier.Builder(file).setMinCheckedPlatformVersion(Build.VERSION.SDK_INT)
            .setMaxCheckedPlatformVersion(Build.VERSION.SDK_INT).build().verify()
        requireUpdate(signed.isVerified,"APK cryptographic signature verification failed.")
        val pm=context.packageManager
        val archive=pm.getPackageArchiveInfo(file.path,flags()) ?: throw IOException("Android could not verify the APK archive/signers.")
        val current=installed()
        requireUpdate(archive.packageName==context.packageName,"Wrong APK package.")
        requireUpdate(code(archive)==candidate.code && code(archive)>code(current),"Wrong version or downgrade APK.")
        requireUpdate(archive.applicationInfo != null && archive.applicationInfo!!.minSdkVersion <= Build.VERSION.SDK_INT,"APK requires a newer Android version.")
        val before=signers(current); val after=signers(archive)
        requireUpdate(before.isNotEmpty() && after.isNotEmpty(),"APK signing identity is missing.")
        // Android verifies signing lineage in PackageParser. Multiple signers require exact equality.
        val lineage = if(Build.VERSION.SDK_INT>=28 && archive.signingInfo?.hasMultipleSigners()==false) archive.signingInfo?.signingCertificateHistory?.map { sha(it.toByteArray()) }?.toSet() ?: emptySet() else emptySet()
        val verifiedSigners=signed.signerCertificates.map { sha(it.encoded) }.toSet()
        requireUpdate(verifiedSigners==after,"APK signer parsers disagree.")
        val rotationAllowsData = if(Build.VERSION.SDK_INT>=28 && before.size==1 && lineage.containsAll(before)) {
            val proof=signed.signingCertificateLineage
            val ancestor=proof?.certificatesInLineage?.firstOrNull { sha(it.encoded) in before }
            ancestor!=null && proof.getSignerCapabilities(ancestor).hasInstalledData()
        } else false
        val compatible = before==after || rotationAllowsData
        requireUpdate(compatible,"APK signer is incompatible with the installed app.")
        requireUpdate(UpdaterBuildConfig.CERT_SHA256 in before || (Build.VERSION.SDK_INT>=28 && current.signingInfo?.signingCertificateHistory?.any { sha(it.toByteArray())==UpdaterBuildConfig.CERT_SHA256 }==true),"Installed signer is not the trusted YTArk signing identity.")
    }
    companion object {
        fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
        fun sha(bytes: ByteArray) = hex(MessageDigest.getInstance("SHA-256").digest(bytes))
    }
}
