package io.github.twoarchiver.ytark.updater

/** Display-only interpretation of the existing state. Never drives update eligibility. */
object UpdatePresentation {
    fun latest(s: UpdateState): String = when {
        s.candidate != null -> s.candidate.version
        s.latestVersion.isNotBlank() -> s.latestVersion
        else -> "Not confirmed"
    }

    fun latestLabel(s: UpdateState): String {
        val hasVersion = s.candidate != null || s.latestVersion.isNotBlank()
        return when {
            s.stale || s.latestVersionStale -> "Last known compatible stable"
            hasVersion && (s.phase == UpdatePhase.Checking || s.phase == UpdatePhase.Failed || s.errorCategory.isNotBlank()) ->
                "Last confirmed compatible stable"
            hasVersion -> "Latest compatible stable"
            else -> "Latest compatible stable (unconfirmed)"
        }
    }

    fun status(s: UpdateState): String = when {
        s.phase == UpdatePhase.Idle && s.candidate == null && s.latestVersion.isNotBlank() && s.errorCategory.isBlank() && !s.stale ->
            if (s.installedAhead) "Installed version is newer than the latest stable release." else "You're on the latest version."
        s.latestVersion.isBlank() && s.phase == UpdatePhase.Idle && s.lastSuccess > 0 && s.message.startsWith("Installed version is current.") ->
            "Saved check status cannot confirm the latest version. Check again."
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
