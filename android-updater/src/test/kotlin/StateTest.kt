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

    // Storage/controller creation and preparation failures stay explicit and retryable.
    val createAttempts=java.util.concurrent.atomic.AtomicInteger()
    val prepareAttempts=java.util.concurrent.atomic.AtomicInteger()
    val controller=Any()
    val dependency=RetryableDependency(
        create={ createAttempts.incrementAndGet(); controller },
        prepare={ if(prepareAttempts.incrementAndGet()==1) throw java.io.IOException("storage unavailable") },
    )
    val failedPreparation=dependency.acquire()
    check(failedPreparation is DependencyResult.Unavailable)
    check(dependency.readyValue()==null)
    check(dependency.lastFailure() is java.io.IOException)
    val restored=dependency.acquire()
    check(restored is DependencyResult.Ready && restored.value===controller)
    check(dependency.acquire() is DependencyResult.Ready)
    check(createAttempts.get()==1 && prepareAttempts.get()==2)
    check(dependency.lastFailure()==null && dependency.readyValue()===controller)

    val createFailureAttempts=java.util.concurrent.atomic.AtomicInteger()
    val createFailure=RetryableDependency(
        create={ if(createFailureAttempts.incrementAndGet()==1) throw java.io.IOException("controller unavailable") else Any() },
        prepare={},
    )
    check(createFailure.acquire() is DependencyResult.Unavailable)
    check(createFailure.readyValue()==null)
    check(createFailure.acquire() is DependencyResult.Ready)
    check(createFailureAttempts.get()==2)

    // Concurrent callers share one preparation; failure/retry cannot race a lateinit-style read.
    val prepareCount=java.util.concurrent.atomic.AtomicInteger()
    val enteredPrepare=java.util.concurrent.CountDownLatch(1)
    val allowPrepare=java.util.concurrent.CountDownLatch(1)
    val concurrentDependency=RetryableDependency(
        create={ Any() },
        prepare={
            if(prepareCount.incrementAndGet()==1) {
                enteredPrepare.countDown()
                check(allowPrepare.await(2,java.util.concurrent.TimeUnit.SECONDS))
            }
        },
    )
    val answers=java.util.concurrent.CopyOnWriteArrayList<DependencyResult<Any>>()
    val readers=(1..6).map { Thread { answers.add(concurrentDependency.acquire()) } }
    readers.forEach { it.start() }
    check(enteredPrepare.await(2,java.util.concurrent.TimeUnit.SECONDS))
    allowPrepare.countDown()
    readers.forEach { it.join(2000); check(!it.isAlive) }
    check(prepareCount.get()==1 && answers.size==6)
    val sharedValue=(answers.first() as DependencyResult.Ready).value
    check(answers.all { it is DependencyResult.Ready && it.value===sharedValue })

    val optionalAttempts=java.util.concurrent.atomic.AtomicInteger()
    val optionalController=Any()
    val storageAccess=UpdateStorageAccess(
        RetryableDependency(create={ optionalController },prepare={}),
    ) { if(optionalAttempts.incrementAndGet()==1) throw java.io.IOException("temporary storage failure") }
    check(storageAccess.optional() is DependencyResult.Unavailable) // metadata/cleanup can report and continue
    check(storageAccess.required()===optionalController) // explicit action retries storage and proceeds only when ready
    check(optionalAttempts.get()==2)
    val unavailableAccess=UpdateStorageAccess(
        RetryableDependency(create={ Any() },prepare={}),
    ) { throw java.io.IOException("storage remains unavailable") }
    try {
        unavailableAccess.required()
        error("required storage must not report success")
    } catch(expected: UpdateStorageFailure) {
        check(expected.message.orEmpty().contains("storage is unavailable"))
    }

    check(PendingInstallPolicy.mayContinue("a","a",true,true))
    check(!PendingInstallPolicy.mayContinue("a","b",true,true))
    check(!PendingInstallPolicy.mayContinue("a","a",false,true))
    check(!PendingInstallPolicy.mayContinue("a","a",true,false))
    check(!PendingInstallPolicy.mayContinue(null,"a",true,true))
    check(PendingInstallPolicy.mayQueueContinuation("a","a",UpdatePhase.AwaitingPermission,workerBusy=true))
    check(PendingInstallPolicy.mayQueueContinuation("a","a",UpdatePhase.Validating,workerBusy=true))
    check(!PendingInstallPolicy.mayQueueContinuation("a","b",UpdatePhase.AwaitingPermission,workerBusy=true))
    check(!PendingInstallPolicy.mayQueueContinuation(null,"a",UpdatePhase.AwaitingPermission,workerBusy=false))
    check(!PendingInstallPolicy.mayQueueContinuation("a","a",UpdatePhase.Ready,workerBusy=false))

    // Permission Settings route ownership survives lifecycle/process restoration.
    val detours=PermissionDetourCoordinator()
    val entryStart=detours.beginEntry()
    check(entryStart.kind==PermissionDetourStartKind.STARTED)
    val entryRoute=entryStart.route!!
    check(detours.beginEntry().kind==PermissionDetourStartKind.ALREADY_ACTIVE)
    check(detours.markLaunched(entryRoute.requestId))
    check(!detours.observeReturn(entryRoute.requestId)) // resume without an observed departure is not a return
    val installIdentity="v3.6.0:"+"a".repeat(64)
    val joined=detours.beginInstall(installIdentity)
    check(joined.kind==PermissionDetourStartKind.JOINED && joined.route?.requestId==entryRoute.requestId)
    check(joined.route?.owner==PermissionDetourOwner.ENTRY)
    check(detours.current?.candidateIdentity==installIdentity)
    check(detours.beginInstall("different-candidate").kind==PermissionDetourStartKind.BLOCKED)
    check(detours.markDeparted())
    val departedRevision=detours.snapshot().revision
    check(detours.markDeparted())
    check(detours.snapshot().revision==departedRevision) // duplicate pauses do not advance route state
    check(detours.observeReturn(entryRoute.requestId))
    check(!detours.observeReturn(entryRoute.requestId,fromActivityResult=true))
    check(detours.canContinue(installIdentity,true,true))
    check(!detours.canContinue("other",true,true))
    check(!detours.canContinue(installIdentity,false,true))
    check(!detours.canContinue(installIdentity,true,false))
    val savedDetour=detours.snapshot()
    check(savedDetour.revision>0L)
    val staleBundle=savedDetour.copy(current=null,revision=savedDetour.revision-1L)
    val newerBundle=savedDetour.copy(revision=savedDetour.revision+1L)
    check(PermissionDetourSnapshot.mostRecent(savedDetour,staleBundle)==savedDetour)
    check(PermissionDetourSnapshot.mostRecent(savedDetour,newerBundle)==newerBundle)
    val restoredDetour=PermissionDetourCoordinator(savedDetour)
    check(restoredDetour.current==detours.current)
    check(restoredDetour.canContinue(installIdentity,true,true))
    check(restoredDetour.acceptContinuation(entryRoute.requestId,installIdentity))
    check(!restoredDetour.acceptContinuation(entryRoute.requestId,installIdentity))
    check(restoredDetour.complete(entryRoute.requestId))
    check(restoredDetour.current==null)

    val resultRoute=PermissionDetourCoordinator()
    val installStart=resultRoute.beginInstall(installIdentity)
    check(installStart.kind==PermissionDetourStartKind.STARTED)
    val installRoute=installStart.route!!
    check(resultRoute.beginInstall(installIdentity).kind==PermissionDetourStartKind.ALREADY_ACTIVE)
    check(resultRoute.markLaunched(installRoute.requestId))
    check(resultRoute.observeReturn(installRoute.requestId,fromActivityResult=true)) // result proves a return without pause
    check(resultRoute.current?.departed==true && resultRoute.current?.returned==true)
    check(resultRoute.detachCandidate(installRoute.requestId,installIdentity))
    check(resultRoute.current==null) // standalone install routes are discarded when cancelled
    val returnedAfterRecreation=PermissionDetourCoordinator(PermissionDetourSnapshot(
        2L, PermissionDetour(1L,PermissionDetourOwner.INSTALL,installIdentity),4L,
    ))
    check(returnedAfterRecreation.observeReturn(1L,fromActivityResult=true))
    check(returnedAfterRecreation.current?.launched==true && returnedAfterRecreation.current?.departed==true)
    check(returnedAfterRecreation.current?.returned==true)

    val failedEntry=PermissionDetourCoordinator()
    val failedStart=failedEntry.beginEntry().route!!
    check(failedEntry.markLaunchFailed(failedStart.requestId))
    check(failedEntry.current==null)
    check(!failedEntry.markLaunched(failedStart.requestId))
    val nextEntry=failedEntry.beginEntry().route!!
    check(nextEntry.requestId>failedStart.requestId)
    check(failedEntry.markLaunched(nextEntry.requestId))
    check(!failedEntry.observeReturn(nextEntry.requestId))
    check(failedEntry.markDeparted())
    check(failedEntry.observeReturn(nextEntry.requestId))
    check(!failedEntry.acceptContinuation(nextEntry.requestId,null))
    check(failedEntry.complete(nextEntry.requestId))

    val rejectedInstall=PermissionDetourCoordinator()
    val rejectedIdentity="v3.6.0:"+"b".repeat(64)
    val rejectedRoute=rejectedInstall.beginInstall(rejectedIdentity).route!!
    check(rejectedInstall.markLaunchFailed(rejectedRoute.requestId))
    check(rejectedInstall.current==null)
    check(rejectedInstall.beginInstall(rejectedIdentity).kind==PermissionDetourStartKind.STARTED)

    val sharedEntry=PermissionDetourCoordinator()
    val shared=sharedEntry.beginEntry().route!!
    sharedEntry.markLaunched(shared.requestId)
    val candidateToDetach="candidate-a"
    sharedEntry.beginInstall(candidateToDetach)
    check(sharedEntry.detachCandidate(shared.requestId,candidateToDetach))
    check(sharedEntry.current?.owner==PermissionDetourOwner.ENTRY && sharedEntry.current?.candidateIdentity==null)

    // Native measurements are allowlisted, bounded, local and clock-domain honest.
    check(NativeDiagnosticsPolicy.cleanEvent(0,"native_bootstrap_ready")!=null)
    check(NativeDiagnosticsPolicy.cleanEvent(0,"native_first_activity_resumed")!=null)
    check(NativeDiagnosticsPolicy.cleanEvent(0,"check_completed",25,"candidate")!=null)
    check(NativeDiagnosticsPolicy.cleanEvent(0,"raw_url_https_example_com") == null)
    check(NativeDiagnosticsPolicy.cleanEvent(0,"check_completed",25,"https://example.invalid") == null)
    val boundedEvent=NativeDiagnosticsPolicy.cleanEvent(Long.MAX_VALUE,"check_completed",Long.MAX_VALUE,"candidate")!!
    check(boundedEvent.elapsedOffsetMs==NativeDiagnosticsPolicy.MAX_OFFSET_MS)
    check(boundedEvent.durationMs==NativeDiagnosticsPolicy.MAX_DURATION_MS)
    var nativeSamples=listOf<NativeDiagnosticSession>()
    for(sample in 1L..12L) {
        repeat(45) { index ->
            nativeSamples=NativeDiagnosticsPolicy.append(nativeSamples,sample,index.toLong(),"check_completed",index.toLong(),"candidate")
        }
    }
    check(nativeSamples.size<=NativeDiagnosticsPolicy.MAX_SESSIONS)
    check(nativeSamples.sumOf { it.events.size }<=NativeDiagnosticsPolicy.MAX_TOTAL_EVENTS)
    check(nativeSamples.all { it.events.size<=NativeDiagnosticsPolicy.MAX_EVENTS_PER_SESSION })
    val encodedNative=NativeDiagnosticsPolicy.serialize(nativeSamples)
    check(encodedNative.length<=NativeDiagnosticsPolicy.MAX_SERIALIZED_CHARS)
    val decodedNative=NativeDiagnosticsPolicy.deserialize(encodedNative)
    check(decodedNative==nativeSamples)
    check(!encodedNative.contains("http") && !encodedNative.contains("package:"))
    val nativeReport=NativeDiagnosticsPolicy.report(NativeDiagnosticsSnapshot(false,nativeSamples))
    check(nativeReport.contains("Collection: Off"))
    check(nativeReport.contains("native bootstrap/first-activity milestones"))
    check(nativeReport.contains("not reconstructed; enable before the next launch"))
    check(nativeReport.contains("elapsedRealtime"))
    check(nativeReport.contains("Browser measurements are separate"))
    check(nativeReport.contains("no comparison with browser clocks"))
    check(nativeReport.contains("fixed granted/denied/unknown outcome"))
    check(nativeReport.contains("never as raw system settings"))
    check(NativeDiagnosticsPolicy.report(NativeDiagnosticsSnapshot(false,emptyList())).contains("No native updater diagnostic events"))
    val hostileNativeReport=NativeDiagnosticsPolicy.report(NativeDiagnosticsSnapshot(false,emptyList(),"secret="+"x".repeat(10_000)))
    check(hostileNativeReport.contains("Storage state: unavailable"))
    check(!hostileNativeReport.contains("secret=") && hostileNativeReport.length<=NativeDiagnosticsPolicy.MAX_REPORT_CHARS)
    check(UpdateState(phase=UpdatePhase.AwaitingInstaller).busy)
    check(!UpdateState(phase=UpdatePhase.Ready).busy)
    val legacyCurrent = UpdateState(message="Installed version is current. Latest compatible: 3.1.0.",lastSuccess=1)
    check(UpdatePresentation.status(legacyCurrent)=="Saved check status cannot confirm the latest version. Check again.")
    check(UpdatePresentation.latest(legacyCurrent)=="Not confirmed") // Never trust an old status string as version metadata.
    check(UpdatePresentation.latestLabel(legacyCurrent)=="Latest compatible stable (unconfirmed)")
    check(UpdatePresentation.latest(UpdateState())=="Not confirmed")
    // Structured fields carry the stable version; status text is never parsed to learn it.
    val structured = UpdateStates.upToDate(UpdateState(phase=UpdatePhase.Failed, message="Old HTTP error", errorCategory="http"), "3.3.0", 5L)
    check(structured.latestVersion=="3.3.0")
    check(UpdatePresentation.latest(structured)=="3.3.0")
    check(UpdatePresentation.latestLabel(structured)=="Latest compatible stable")
    check(UpdatePresentation.status(structured)=="You're up to date — v3.3.0.")
    check(structured.phase==UpdatePhase.Idle && structured.candidate==null && structured.verifiedPath==null)
    check(structured.pendingIdentity==null && !structured.busy && structured.errorCategory.isBlank())
    check(structured.stage.isBlank() && structured.httpStatus==0 && structured.retryAt==0L)
    val installedAhead = UpdateStates.upToDate(UpdateState(), "3.3.0", 6L, installedAhead=true)
    check(installedAhead.installedAhead)
    check(UpdatePresentation.status(installedAhead)=="Installed version is newer than the latest stable release — v3.3.0.")
    check(UpdatePresentation.latest(installedAhead)=="3.3.0")
    val priorFailure = UpdateStates.failed(UpdateState(latestVersion="3.3.0",lastSuccess=5L), MappedError("http","HTTP error","",100L,403,"check"), "v3.3.0")
    check(UpdatePresentation.status(priorFailure)=="HTTP error")
    check(UpdatePresentation.latestLabel(priorFailure)=="Last confirmed compatible stable")
    val staleCurrent = UpdateState(phase=UpdatePhase.Idle, latestVersion="3.3.0", stale=true, errorCategory="rate_limit", message="Rate limited.", latestVersionStale=true)
    check(UpdatePresentation.status(staleCurrent)=="Rate limited.")
    check(UpdatePresentation.latestLabel(staleCurrent)=="Last known compatible stable")
    val retryingStale = UpdateStates.checking(staleCurrent)
    check(!retryingStale.stale && retryingStale.errorCategory.isBlank())
    check(UpdatePresentation.latestLabel(retryingStale)=="Last known compatible stable") { "retry keeps stale provenance honest" }
    val failedStaleRetry = UpdateStates.failed(retryingStale, MappedError("http","HTTP error","",100L,403,"check"), "v3.3.0")
    check(UpdatePresentation.latestLabel(failedStaleRetry)=="Last known compatible stable")
    check(UpdateStates.installed(structured).latestVersion=="")
    check(!UpdateStates.installed(structured).installedAhead)
    val candidate = Candidate("v3.2.0",3020000,"asset","url",10485760,"digest","# Very long notes " + "detail ".repeat(1000))
    val staleAvailable = UpdateStates.staleAvailable(UpdateState(), candidate, 100L, "Rate limited.", 429)
    check(staleAvailable.latestVersionStale)
    check(staleAvailable.httpStatus==429)
    check(staleAvailable.releaseTag==candidate.tag)
    check(staleAvailable.verifiedPath==null)
    val differentStaleCandidate = UpdateStates.staleAvailable(
        UpdateState(phase=UpdatePhase.Ready, candidate=candidate.copy(tag="v3.1.1", code=3010100), verifiedPath="/old.apk"),
        candidate, 100L, "Rate limited.", 429,
    )
    check(differentStaleCandidate.verifiedPath==null)
    val sameStaleCandidate = UpdateStates.staleAvailable(
        UpdateState(phase=UpdatePhase.Ready, candidate=candidate, verifiedPath="/verified.apk"),
        candidate, 100L, "Rate limited.", 429,
    )
    check(sameStaleCandidate.verifiedPath=="/verified.apk")
    check(UpdatePresentation.latestLabel(staleAvailable)=="Last known compatible stable")
    val available = UpdateState(UpdatePhase.Available,candidate,"YTArk 3.2.0 is available.")
    check(UpdatePresentation.status(available)=="Newer version available — v3.2.0.")
    check(UpdatePresentation.latest(available)=="3.2.0")
    val failedAvailableCheck = UpdateStates.failed(available, MappedError("http","Update check failed","",100L,403,"check"), "v3.2.0")
    check(UpdatePresentation.latestLabel(failedAvailableCheck)=="Last confirmed compatible stable")
    check(UpdatePresentation.status(available.copy(message="Download cancelled. Retry when ready."))=="Download cancelled. Retry when ready.")
    check(UpdatePresentation.status(available.copy(phase=UpdatePhase.Downloading,bytes=1048576))=="Downloading · 1.0 MB / 10.0 MB")
    check(UpdatePresentation.progress(512,0,0)=="Downloading · 512 B")
    check(UpdatePresentation.technical(UpdateState(phase=UpdatePhase.Failed,detail="Stage: check",errorCategory="rate_limit",httpStatus=403,releaseTag="v3.3.0")).contains("HTTP status: 403"))
    val legacyTechnical=UpdatePresentation.technical(UpdateState(
        phase=UpdatePhase.Failed,
        stage="check",
        errorCategory="rate_limit",
        httpStatus=403,
        releaseTag="v3.9.0",
        detail="Stage: check\nCategory: rate_limit\nRelease: v3.9.0\nHTTP status: 403\nCause chain:\n1. IOException: see https://secret.example/token=abc\nCause chain:\n2. IOException: token=hidden",
    ))
    check(legacyTechnical.lines().count { it.startsWith("Stage:") }==1)
    check(legacyTechnical.lines().count { it.startsWith("Category:") }==1)
    check(legacyTechnical.lines().count { it.startsWith("Release:") }==1)
    check(legacyTechnical.lines().count { it.startsWith("HTTP status:") }==1)
    check(legacyTechnical.lines().count { it.startsWith("Cause chain:") }==1)
    check(!legacyTechnical.contains("secret.example") && !legacyTechnical.contains("token=abc") && !legacyTechnical.contains("token=hidden"))
    check(UpdatePresentation.technical(UpdateState(releaseTag="v3.9.0")).isEmpty())
    val hostileTechnical=UpdatePresentation.technical(UpdateState(
        phase=UpdatePhase.Failed,stage="<img onerror=alert(1)>",errorCategory="html",httpStatus=999,
        releaseTag="https://secret.example/update",detail="Cause chain:\n1. IOException: /data/user/0/io.github.twoarchiver.ytark/private.apk token=abc",
    ))
    check(!hostileTechnical.contains("<img") && !hostileTechnical.contains("https://") && !hostileTechnical.contains("/data/user/0"))
    check(hostileTechnical.contains("[path]") && hostileTechnical.contains("token=[redacted]"))
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
    // API 24–25 use the legacy global unknown-sources setting. The modern
    // per-source prerequisites (target 26+, declared permission) belong to the
    // Android 8+ route and must not classify or disable the legacy flow.
    check(InstallCapabilityPolicy.state(24,36,true,false)==InstallCapabilityPolicy.STATE_NOT_AUTHORIZED)
    check(InstallCapabilityPolicy.state(25,22,false,false)==InstallCapabilityPolicy.STATE_NOT_AUTHORIZED)
    check(InstallCapabilityPolicy.state(24,36,true,true)==InstallCapabilityPolicy.STATE_GRANTED)
    check(InstallCapabilityPolicy.state(25,36,true,null)==InstallCapabilityPolicy.STATE_UNREADABLE)
    check(InstallCapabilityPolicy.state(23,36,true,true)==InstallCapabilityPolicy.STATE_UNREADABLE)
    check(InstallCapabilityPolicy.state(26,25,true,false)==InstallCapabilityPolicy.STATE_TARGET_TOO_OLD)
    check(InstallCapabilityPolicy.canHoldAuthorization(24,null,null))
    check(InstallCapabilityPolicy.canHoldAuthorization(25,22,false))
    check(!InstallCapabilityPolicy.canHoldAuthorization(23,36,true))
    check(!InstallCapabilityPolicy.canHoldAuthorization(26,25,true))
    check(!InstallCapabilityPolicy.canHoldAuthorization(34,36,false))
    // The legacy explanation names the global setting, never the per-app switch.
    check(InstallCapabilityPolicy.explanation(InstallCapabilityPolicy.STATE_NOT_AUTHORIZED,24).contains("global"))
    check(!InstallCapabilityPolicy.explanation(InstallCapabilityPolicy.STATE_NOT_AUTHORIZED,24).contains("per-package system value"))
    check(InstallCapabilityPolicy.explanation(InstallCapabilityPolicy.STATE_NOT_AUTHORIZED,34).contains("per-package system value"))
    check(InstallCapabilityPolicy.explanation(InstallCapabilityPolicy.STATE_GRANTED,24)==InstallCapabilityPolicy.explanation(InstallCapabilityPolicy.STATE_GRANTED))
    // Launch classification: resolution is not a precheck; only real attempts count.
    check(InstallPermissionEntryPolicy.openOutcome(listOf(InstallPermissionEntryPolicy.LAUNCH_OK))==null)
    check(InstallPermissionEntryPolicy.openOutcome(listOf(InstallPermissionEntryPolicy.LAUNCH_NOT_FOUND,InstallPermissionEntryPolicy.LAUNCH_BLOCKED))==InstallPermissionEntryPolicy.OUTCOME_BLOCKED)
    check(InstallPermissionEntryPolicy.openOutcome(listOf(InstallPermissionEntryPolicy.LAUNCH_NOT_FOUND))==InstallPermissionEntryPolicy.OUTCOME_UNAVAILABLE)
    check(InstallPermissionEntryPolicy.openOutcome(emptyList())==InstallPermissionEntryPolicy.OUTCOME_UNAVAILABLE)
    check(InstallPermissionEntryPolicy.openOutcome(null)==InstallPermissionEntryPolicy.OUTCOME_UNAVAILABLE)
    // A pending install continues or clears only after a genuine external return.
    check(!PendingInstallPolicy.mayContinue("a","a",true,true,false))
    check(!PendingInstallPolicy.shouldClear("a","a",false,true,false))
    check(PendingInstallPolicy.shouldClear("a","a",false,true,true))
    check(PendingInstallPolicy.shouldClear("a","b",true,true,true))
    check(!PendingInstallPolicy.shouldClear(null,"a",true,true,true))
    check(PendingInstallPolicy.mayContinue("a","a",true,true,true))
    check(ReleaseHighlights.summary("3.2.0").length<=240)
    check(ReleaseHighlights.summary("v3.2.0")==ReleaseHighlights.summary("3.2.0"))
    check(ReleaseHighlights.summary("99.0.0")==ReleaseHighlights.FALLBACK)
    check(ReleaseHighlights.details("3.2.0")!!.contains("Known limitations"))
    check(!ReleaseHighlights.summary("3.2.0").contains("Known limitations"))
    check(UpdatePresentation.releaseDetails("# Notes\n- **Clear** <b>text</b> &amp; [link](https://example.com)<!--hidden-->")=="Notes\n• Clear text & link")
    check(UpdatePresentation.releaseDetails("")=="No release notes provided.")
    println("Kotlin presentation/highlights tests passed.")
    println("Kotlin state/scheduling/permission identity/capability tests passed.")
}
