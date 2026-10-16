package io.github.twoarchiver.ytark.updater

fun main() {
    check(ScheduleRules.interval(null)==1)
    check(ScheduleRules.interval(null,false)==0)
    check(ScheduleRules.interval(3)==3)
    check(ScheduleRules.interval(2)==1)
    check(!ScheduleRules.due(0,99999999,0,0,0))
    check(!ScheduleRules.due(3,2*ScheduleRules.HOUR,1,1,0))
    check(ScheduleRules.due(1,2*ScheduleRules.HOUR,1,1,0))
    check(!ScheduleRules.due(1,100000,99000,0,0))
    check(!ScheduleRules.due(1,120000,60000,0,0)) // never-confirmed checks must not poll every minute
    check(ScheduleRules.due(1,ScheduleRules.HOUR,0,0,0))
    check(!ScheduleRules.due(1,100000,0,0,100001))
    check(PendingInstallPolicy.mayContinue("a","a",true,true))
    check(!PendingInstallPolicy.mayContinue("a","b",true,true))
    check(!PendingInstallPolicy.mayContinue("a","a",false,true))
    check(!PendingInstallPolicy.mayContinue("a","a",true,false))
    check(!PendingInstallPolicy.mayContinue(null,"a",true,true))
    check(UpdateState(phase=UpdatePhase.AwaitingInstaller).busy)
    check(!UpdateState(phase=UpdatePhase.Ready).busy)
    val current = UpdateState(message="Installed version is current. Latest compatible: 3.1.0.",lastSuccess=1)
    check(UpdatePresentation.status(current)=="Up to date")
    check(UpdatePresentation.latest(current)=="3.1.0") // Do not invent 3.2 as latest when running a candidate.
    check(UpdatePresentation.latest(UpdateState())=="Not available")
    // Structured fields carry the latest version; status text is never parsed to learn it.
    val structured = UpdateStates.upToDate(UpdateState(), "3.3.0", 5L)
    check(structured.latestVersion=="3.3.0")
    check(UpdatePresentation.latest(structured)=="3.3.0")
    check(UpdatePresentation.status(structured)=="Up to date")
    check(UpdateStates.installed(structured).latestVersion=="")
    val candidate = Candidate("v3.2.0",3020000,"asset","url",10485760,"digest","# Very long notes " + "detail ".repeat(1000))
    val available = UpdateState(UpdatePhase.Available,candidate,"YTArk 3.2.0 is available.")
    check(UpdatePresentation.status(available)=="Update available")
    check(UpdatePresentation.latest(available)=="3.2.0")
    check(UpdatePresentation.status(available.copy(message="Download cancelled. Retry when ready."))=="Download cancelled. Retry when ready.")
    check(UpdatePresentation.status(available.copy(phase=UpdatePhase.Downloading,bytes=1048576))=="Downloading · 1.0 MB / 10.0 MB")
    check(UpdatePresentation.progress(512,0,0)=="Downloading · 512 B")
    check(UpdatePresentation.technical(UpdateState(phase=UpdatePhase.Failed,detail="Stage: check",errorCategory="rate_limit",httpStatus=403,releaseTag="v3.3.0")).contains("HTTP status: 403"))
    for(phase in listOf(UpdatePhase.Checking,UpdatePhase.Failed,UpdatePhase.AwaitingPermission,UpdatePhase.AwaitingInstaller)) {
        check(UpdatePresentation.status(UpdateState(phase=phase,message="Guidance"))=="Guidance")
    }
    // Install authorization: the honest reason Android gives, never a made-up one.
    check(InstallCapabilityPolicy.state(34,true,true)==InstallCapabilityPolicy.STATE_GRANTED)
    check(InstallCapabilityPolicy.state(34,true,false)==InstallCapabilityPolicy.STATE_NOT_AUTHORIZED)
    check(InstallCapabilityPolicy.state(22,true,false)==InstallCapabilityPolicy.STATE_TARGET_TOO_OLD)
    check(InstallCapabilityPolicy.state(25,true,true)==InstallCapabilityPolicy.STATE_TARGET_TOO_OLD)
    check(InstallCapabilityPolicy.state(26,true,true)==InstallCapabilityPolicy.STATE_GRANTED)
    check(InstallCapabilityPolicy.state(34,false,false)==InstallCapabilityPolicy.STATE_PERMISSION_NOT_DECLARED)
    check(InstallCapabilityPolicy.state(null,true,true)==InstallCapabilityPolicy.STATE_UNREADABLE)
    check(InstallCapabilityPolicy.state(34,null,true)==InstallCapabilityPolicy.STATE_UNREADABLE)
    check(InstallCapabilityPolicy.state(0,true,true)==InstallCapabilityPolicy.STATE_UNREADABLE)
    check(InstallCapabilityPolicy.canHoldAuthorization(34,true))
    check(!InstallCapabilityPolicy.canHoldAuthorization(22,true))
    check(!InstallCapabilityPolicy.canHoldAuthorization(34,false))
    check(!InstallCapabilityPolicy.canHoldAuthorization(null,true))
    check(!InstallCapabilityPolicy.canHoldAuthorization(34,null))
    for(state in listOf(InstallCapabilityPolicy.STATE_GRANTED,InstallCapabilityPolicy.STATE_TARGET_TOO_OLD,
                        InstallCapabilityPolicy.STATE_PERMISSION_NOT_DECLARED,InstallCapabilityPolicy.STATE_NOT_AUTHORIZED,
                        InstallCapabilityPolicy.STATE_UNREADABLE,"something-else")) {
        check(InstallCapabilityPolicy.explanation(state).isNotBlank())
    }
    // The reason that a settings screen cannot repair is stated as such, and the
    // unknown state never accuses the device or the profile.
    check(InstallCapabilityPolicy.explanation(InstallCapabilityPolicy.STATE_TARGET_TOO_OLD).contains("below 8"))
    check(!InstallCapabilityPolicy.explanation(InstallCapabilityPolicy.STATE_TARGET_TOO_OLD).contains("device policy"))
    check(InstallCapabilityPolicy.explanation(InstallCapabilityPolicy.STATE_PERMISSION_NOT_DECLARED).contains("REQUEST_INSTALL_PACKAGES"))
    check(!InstallCapabilityPolicy.explanation(InstallCapabilityPolicy.STATE_NOT_AUTHORIZED).contains("administrator"))
    check(InstallCapabilityPolicy.settingsRoute(34,true)==InstallCapabilityPolicy.ROUTE_PACKAGE)
    check(InstallCapabilityPolicy.settingsRoute(34,false)==InstallCapabilityPolicy.ROUTE_LIST)
    check(InstallCapabilityPolicy.settingsRoute(25,true)==InstallPermissionEntryPolicy.ROUTE_SECURITY_SETTINGS)
    check(InstallCapabilityPolicy.settingsRoute(23,true)==InstallPermissionEntryPolicy.ROUTE_SECURITY_SETTINGS)
    // The AppOp name the TV's switch writes is @hide in the public SDK, so the
    // build pins the documented string; a typo here would silently read nothing.
    check(InstallCapabilityPolicy.INSTALL_APP_OP=="android:request_install_packages")
    check(InstallCapabilityPolicy.INSTALL_APP_OP.startsWith("android:"))
    check(ReleaseHighlights.summary("3.2.0").length<=240)
    check(ReleaseHighlights.summary("v3.2.0")==ReleaseHighlights.summary("3.2.0"))
    check(ReleaseHighlights.summary("99.0.0")==ReleaseHighlights.FALLBACK)
    check(ReleaseHighlights.details("3.2.0")!!.contains("Known limitations"))
    check(!ReleaseHighlights.summary("3.2.0").contains("Known limitations"))
    check(UpdatePresentation.releaseDetails("# Notes\n- **Clear** <b>text</b> &amp; [link](https://example.com)<!--hidden-->")=="Notes\n• Clear text & link")
    check(UpdatePresentation.releaseDetails("")=="No release notes provided.")
    println("Kotlin presentation/highlights tests passed.")
    println("Kotlin state/scheduling/permission identity tests passed (17 assertions).")
}
