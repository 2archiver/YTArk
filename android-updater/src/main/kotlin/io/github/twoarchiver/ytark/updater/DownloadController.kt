package io.github.twoarchiver.ytark.updater

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.io.InterruptedIOException
import java.util.concurrent.atomic.AtomicBoolean

/** Restart partial transfers cleanly: never append an unvalidated HTTP range. */
class DownloadController(context: Context, private val http: ReleaseHttp, private val validator: ApkValidator) {
    val directory=File(context.filesDir,"ytark-updates-v31")
    init { requireUpdate(directory.mkdirs() || directory.isDirectory,"Cannot create update storage."); requireUpdate(UpdateGuards.isSafeUpdateDirectory(context.filesDir,directory),"Unsafe update storage.") }
    fun file(c: Candidate) = File(directory,"${c.code}-${c.sha256}.apk").also { requireUpdate(UpdateGuards.isSafeUpdateFile(directory,it),"Unsafe APK path.") }
    fun download(c: Candidate, cancelled: AtomicBoolean, progress: (Long)->Unit, validating: ()->Unit): File {
        val target=file(c)
        if(target.exists()) { validating(); validator.validate(target,c); return target }
        val part=File(target.path+".part")
        part.delete()
        requireUpdate(UpdateGuards.hasEnoughFreeSpace(directory.usableSpace,c.size,0),"Not enough storage. Free space and retry.")
        val connection=http.open(c.url)
        try {
            requireUpdate(connection.contentLengthLong == -1L || connection.contentLengthLong==c.size,"Download length disagrees with release.")
            requireUpdate(!connection.contentType.orEmpty().contains("text/html",true),"Server returned an error page, not an APK.")
            val deadline=System.nanoTime()+30L*60*1000000000
            connection.inputStream.use { input -> FileOutputStream(part).use { output ->
                val buffer=ByteArray(65536); var bytes=0L; var last=0L
                while(true) {
                    if(cancelled.get()) throw InterruptedIOException("Download cancelled. Retry when ready.")
                    requireUpdate(System.nanoTime()<deadline,"Download timed out. Retry.")
                    val n=input.read(buffer); if(n<0) break
                    bytes+=n; requireUpdate(bytes<=c.size,"Download exceeds expected APK size.")
                    output.write(buffer,0,n)
                    val now=System.currentTimeMillis(); if(now-last>=350 || bytes==c.size) { progress(bytes); last=now }
                }
                output.fd.sync(); requireUpdate(bytes==c.size,"Interrupted download. Retry.")
            } }
            if(cancelled.get()) throw InterruptedIOException("Download cancelled. Retry when ready.")
            validating(); validator.validate(part,c)
            if(cancelled.get()) throw InterruptedIOException("Download cancelled. Retry when ready.")
            requireUpdate(part.renameTo(target),"Could not finalize APK. Check storage.")
            return target
        } finally { connection.disconnect(); part.delete() }
    }
    fun clean(keep: Set<String>) {
        directory.listFiles()?.filter { it.name.matches(Regex("[0-9]+-[0-9a-f]{64}\\.apk(?:\\.part)?")) && it.path !in keep }?.forEach { if(UpdateGuards.isSafeUpdateFile(directory,it)) it.delete() }
    }
}
