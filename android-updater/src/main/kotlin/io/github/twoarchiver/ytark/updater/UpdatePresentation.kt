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
            if (s.installedAhead) "Installed version is newer than the latest stable release — v${s.latestVersion}."
            else "You're up to date — v${s.latestVersion}."
        s.latestVersion.isBlank() && s.phase == UpdatePhase.Idle && s.lastSuccess > 0 && s.message.startsWith("Installed version is current.") ->
            "Saved check status cannot confirm the latest version. Check again."
        s.phase == UpdatePhase.Available && s.candidate != null && s.errorCategory.isBlank() &&
            s.message == "YTArk ${s.candidate.version} is available." ->
            "Newer version available — v${s.candidate.version}."
        s.phase == UpdatePhase.Ready && s.candidate != null && s.errorCategory.isBlank() &&
            s.message == "Update ready. Select Install update; Android will ask for confirmation." ->
            "Verified update ready — v${s.candidate.version}. Select Install update."
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
        // A release tag alone is normal update metadata, not a technical failure.
        if (s.detail.isBlank() && s.errorCategory.isBlank() && s.httpStatus == 0 && s.stage.isBlank()) return ""

        // Saved updater state predates this presentation contract: some versions
        // embedded Stage, Category, Release and HTTP status inside `detail`. Keep
        // only the cause lines from old records, then render each field once.
        val seen = mutableSetOf<String>()
        val causeParts = s.detail.take(16_384).lineSequence().mapNotNull { line ->
            val trimmed = line.trim()
            if (trimmed.isBlank()) return@mapNotNull null
            val field = when {
                trimmed.startsWith("Stage:", ignoreCase = true) -> "stage"
                trimmed.startsWith("Category:", ignoreCase = true) -> "category"
                trimmed.startsWith("Release:", ignoreCase = true) -> "release"
                trimmed.startsWith("HTTP status:", ignoreCase = true) -> "http"
                trimmed.startsWith("Cause chain:", ignoreCase = true) -> "cause-heading"
                else -> null
            }
            if (field != null && !seen.add(field)) return@mapNotNull null
            if (field != null && field != "cause-heading") return@mapNotNull null
            trimmed
        }.take(8).toList()
        // Sanitize the bounded combined text so credentials split across old
        // line boundaries are still recognized before the display cap is applied.
        val cause = UpdateTexts.sanitizeBounded(causeParts.joinToString("\n"), 1600)

        val stage = s.stage.takeIf { it.length <= 32 && it in TECHNICAL_STAGES }
        val category = s.errorCategory.takeIf { it.length <= 40 && it in TECHNICAL_CATEGORIES }
        val tag = safeReleaseTag(s.releaseTag.ifBlank { s.candidate?.tag ?: "" })
        return buildString {
            stage?.let { append("Stage: ").append(it).append('\n') }
            category?.let { append("Category: ").append(it).append('\n') }
            if (s.httpStatus in 100..599) append("HTTP status: ").append(s.httpStatus).append('\n')
            tag?.let { append("Release: ").append(it).append('\n') }
            if (cause.isNotBlank()) append(cause)
        }.trim().take(2000)
    }

    private fun safeReleaseTag(raw: String): String? {
        if (raw.length !in 6..32 || !raw.startsWith('v')) return null
        val version = raw.removePrefix("v")
        return try {
            if (raw == "v$version" && UpdateReleaseContract.expectedVersionCodeForVersion(version) > 0) raw else null
        } catch (_: Exception) { null }
    }

    private val TECHNICAL_STAGES = setOf("check", "download", "validation", "install", "restore", "updater")
    private val TECHNICAL_CATEGORIES = setOf(
        "rate_limit", "forbidden", "no_release", "server", "runtime", "metadata", "storage", "tls",
        "offline", "timeout", "connection", "no_compatible_apk", "signature_mismatch", "verification",
        "permission", "install_cancelled", "cancelled", "download_interrupted", "http", "unexpected",
        "blocked", "invalid", "incompatible", "signature", "conflict", "failure",
        "storage_full", "storage_permission", "storage_read_only", "storage_path",
        "storage_create", "storage_unsafe", "storage_unavailable", "storage_io",
    )

    private fun amount(bytes: Long): String {
        if (bytes < 1024) return "$bytes B"
        if (bytes < 1024 * 1024) return "${bytes / 1024} KB"
        val tenths = bytes * 10 / (1024 * 1024)
        return "${tenths / 10}.${tenths % 10} MB"
    }
}
