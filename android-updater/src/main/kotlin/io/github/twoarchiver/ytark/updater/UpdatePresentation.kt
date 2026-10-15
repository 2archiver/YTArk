package io.github.twoarchiver.ytark.updater

/** Display-only interpretation of the existing 3.1 state. Never drives update eligibility. */
object UpdatePresentation {
    private val current = Regex("^Installed version is current\\. Latest compatible: ([0-9]+\\.[0-9]+\\.[0-9]+)\\.$")
    fun latest(s: UpdateState): String = s.candidate?.version
        ?: current.matchEntire(s.message)?.groupValues?.get(1) ?: "Not available"
    fun status(s: UpdateState): String = when {
        current.matches(s.message) -> "Up to date"
        s.phase == UpdatePhase.Available && s.message == "YTArk ${s.candidate?.version} is available." -> "Update available"
        s.phase == UpdatePhase.Downloading -> progress(s.bytes, s.candidate?.size ?: 0, s.speedBps)
        s.phase == UpdatePhase.Validating -> "Verifying package…"
        else -> s.message // Preserve errors, cancellation and permission/install guidance.
    }

    /** Remote notes are shown only on explicit request, never as installed highlights. */
    fun releaseDetails(raw: String): String = raw
        .replace(Regex("<!--.*?(?:-->|$)", RegexOption.DOT_MATCHES_ALL), "")
        .replace(Regex("<[^>]*>"), "")
        .replace(Regex("!?\\[([^]]*)]\\([^)]*\\)"), "$1")
        .replace(Regex("(?m)^\\s{0,3}#{1,6}\\s*"), "")
        .replace(Regex("(?m)^\\s*[-*+]\\s+"), "• ")
        .replace("**", "").replace("__", "").replace("`", "")
        .replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'")
        .replace("&nbsp;", " ").replace(Regex("&[A-Za-z#0-9]+;"), " ")
        .replace(Regex("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f<>]"), "")
        .trim().ifBlank { "No release notes provided." }

    fun progress(bytes: Long, total: Long, speedBps: Long = 0): String {
        if (total <= 0) return "Downloading · ${amount(bytes)}"
        val base = "Downloading · ${amount(bytes)} / ${amount(total)}"
        return if (speedBps > 0) "$base · ${amount(speedBps)}/s" else base
    }

    fun technical(s: UpdateState): String {
        if (s.detail.isBlank() && s.errorCategory.isBlank() && s.httpStatus == 0 && s.stage.isBlank()) return ""
        return buildString {
            if (s.stage.isNotBlank()) append("Stage: ").append(s.stage).append('\n')
            if (s.errorCategory.isNotBlank()) append("Category: ").append(s.errorCategory).append('\n')
            if (s.httpStatus != 0) append("HTTP status: ").append(s.httpStatus).append('\n')
            val tag = s.releaseTag.ifBlank { s.candidate?.tag ?: "" }
            if (tag.isNotBlank()) append("Release: ").append(tag).append('\n')
            if (s.detail.isNotBlank()) append(s.detail.trim())
        }.trim()
    }

    private fun amount(bytes: Long): String {
        if (bytes < 1024) return "$bytes B"
        if (bytes < 1024 * 1024) return "${bytes / 1024} KB"
        val tenths = bytes * 10 / (1024 * 1024)
        return "${tenths / 10}.${tenths % 10} MB"
    }
}
