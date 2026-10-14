package io.github.twoarchiver.ytark.updater

/** Display-only interpretation of the existing 3.1 state. Never drives update eligibility. */
object UpdatePresentation {
    private val current = Regex("^Installed version is current\\. Latest compatible: ([0-9]+\\.[0-9]+\\.[0-9]+)\\.$")
    fun latest(s: UpdateState): String = s.candidate?.version
        ?: current.matchEntire(s.message)?.groupValues?.get(1) ?: "Not available"
    fun status(s: UpdateState): String = when {
        current.matches(s.message) -> "Up to date"
        s.phase == UpdatePhase.Available && s.message == "YTArk ${s.candidate?.version} is available." -> "Update available"
        s.phase == UpdatePhase.Downloading -> "Downloading · ${s.bytes/1024/1024} / ${(s.candidate?.size ?: 0)/1024/1024} MB"
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
}
