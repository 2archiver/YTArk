package io.github.twoarchiver.ytark.updater

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.*
import java.text.DateFormat
import java.util.Date

/** Stable view tree: progress changes text only, never destroys D-pad focus. */
class UpdateActivity : Activity() {
    private lateinit var updates: UpdateCoordinator
    private lateinit var installer: InstallCoordinator
    private lateinit var status: TextView
    private lateinit var summary: TextView
    private lateinit var installPermissionInfo: TextView
    private lateinit var notes: TextView
    private lateinit var candidateNotes: TextView
    private lateinit var progress: ProgressBar
    private lateinit var checkButton: Button
    private lateinit var allowInstallsButton: Button
    private lateinit var intervalButton: Button
    private lateinit var primaryButton: Button
    private lateinit var cancelButton: Button
    private lateinit var currentNotesButton: Button
    private lateinit var candidateNotesButton: Button
    private lateinit var detailsButton: Button
    private lateinit var nativeDiagnosticsToggleButton: Button
    private lateinit var nativeDiagnosticsReportButton: Button
    private lateinit var nativeDiagnosticsClearButton: Button
    private lateinit var installed: String
    var visible=false; private set
    private var focusId=101
    private var freshEntryPending=false
    private var permissionEntryAttempted=false
    private var recoverMissingPermissionRoute=true
    private lateinit var permissionDetours: PermissionDetourCoordinator
    private val permissionRouteInFlight: Boolean
        get() = permissionDetours.current?.let { it.launched && !it.returned } == true
    private val observer: (UpdateState)->Unit = { s -> render(s); installer.stateChanged(s); reconcileMissingPermissionRoute(s) }
    override fun onCreate(saved: Bundle?) {
        setTheme(android.R.style.Theme_Material_NoActionBar)
        super.onCreate(saved)
        updates=UpdateCoordinator.get(this)
        permissionDetours=PermissionDetourCoordinator(readPermissionDetourSnapshot(saved))
        recoverMissingPermissionRoute=permissionDetours.current==null
        installer=InstallCoordinator(this,updates)
        installed=try { packageManager.getPackageInfo(packageName,0).versionName ?: "Unknown" } catch (_: Exception) { "Unknown" }
        focusId=saved?.getInt("focus",101) ?: 101
        permissionEntryAttempted=saved?.getBoolean("permission_entry_attempted",false)
            ?: (permissionDetours.current?.owner == PermissionDetourOwner.ENTRY)
        freshEntryPending=saved?.getBoolean("fresh_entry_pending",saved==null) ?: (saved==null)
        val scroll=ScrollView(this).apply { isFillViewport=true; setBackgroundColor(NativeThemePolicy.background()) }
        val body=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(dp(32),dp(24),dp(32),dp(24)) }
        fun text(size: Float, secondary: Boolean=false): TextView = TextView(this).apply {
            textSize=size; setTextColor(if(secondary) NativeThemePolicy.secondaryText() else NativeThemePolicy.primaryText())
            setPadding(0,dp(6),0,dp(6)); body.addView(this)
        }
        text(28f).text="YTArk Updates"
        summary=text(16f,true); status=text(18f)
        status.accessibilityLiveRegion=View.ACCESSIBILITY_LIVE_REGION_POLITE
        installPermissionInfo=text(14f,true)
        installPermissionInfo.accessibilityLiveRegion=View.ACCESSIBILITY_LIVE_REGION_POLITE
        fun button(id: Int,label: String,action: ()->Unit) = Button(this).apply {
            this.id=id; text=label; textSize=18f; isAllCaps=false; isFocusable=true
            gravity=Gravity.CENTER_VERTICAL or Gravity.START
            minHeight=dp(48); minimumHeight=dp(48); setPadding(dp(20),dp(10),dp(20),dp(10))
            styleButton(this)
            setOnClickListener { action() }
            setOnFocusChangeListener { _,focused -> if(focused) focusId=id }
            // Content-sized rather than screen-wide, with room for long accessibility text.
            body.addView(this,LinearLayout.LayoutParams(-2,-2).apply { bottomMargin=dp(8) })
        }
        allowInstallsButton=button(108,"Allow installs") { allowInstallAuthorization() }
        checkButton=button(101,"Check for updates") { updates.check() }
        intervalButton=button(102,"Automatically check: Every 1 hour") {
            val choices=arrayOf("Every 1 hour","Every 3 hours","Never")
            val hours=intArrayOf(1,3,0)
            val dialog=AlertDialog.Builder(this,android.R.style.Theme_Material_Dialog_Alert)
                .setTitle("Automatically check")
                .setSingleChoiceItems(choices,hours.indexOf(updates.state.hours)) { dialog,index ->
                    updates.setHours(hours[index]); dialog.dismiss()
                }.setNegativeButton("Back",null).create()
            dialog.setOnDismissListener { intervalButton.requestFocus() }
            dialog.show()
            styleButton(dialog.getButton(AlertDialog.BUTTON_NEGATIVE))
        }
        primaryButton=button(103,"Download & install") { if(updates.state.verifiedPath!=null) installer.install() else updates.download() }
        progress=ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal).apply {
            max=1000; progressTintList=ColorStateList.valueOf(NativeThemePolicy.primaryText())
            indeterminateTintList=ColorStateList.valueOf(NativeThemePolicy.primaryText())
            body.addView(this,LinearLayout.LayoutParams(-1,dp(4)))
        }
        cancelButton=button(104,"Cancel download") { updates.cancel() }
        text(14f,true).text="Android may defer automatic checks. Downloads never open the installer in the background."
        text(21f).text="What's new"
        notes=text(16f)
        notes.text="Installed $installed\n${ReleaseHighlights.summary(installed)}"
        currentNotesButton=button(105,"Full release notes · installed version") {
            showNotes("YTArk $installed",ReleaseHighlights.details(installed) ?: ReleaseHighlights.FALLBACK,currentNotesButton)
        }
        currentNotesButton.isEnabled=ReleaseHighlights.details(installed)!=null
        candidateNotes=text(16f)
        candidateNotesButton=button(106,"Release notes · available update") {
            updates.state.candidate?.let { c ->
                showNotes("YTArk ${c.version}",ReleaseHighlights.details(c.version) ?: UpdatePresentation.releaseDetails(c.notes),candidateNotesButton)
            }
        }
        detailsButton=button(107,"Technical details") {
            val body=UpdatePresentation.technical(updates.state)
            if(body.isNotBlank()) showNotes("Technical details",body,detailsButton)
        }
        detailsButton.visibility=View.GONE
        text(14f,true).text="Android updater diagnostics are separate from browser diagnostics. Native collection defaults off, stays on this device, and can be viewed or cleared here. No installer, download or permission decision is automated by reports."
        nativeDiagnosticsToggleButton=button(109,"Enable Android updater diagnostics") {
            val next=!AndroidDiagnostics.enabled()
            val persisted=AndroidDiagnostics.setEnabled(next)
            renderNativeDiagnosticsControls()
            val message=when {
                persisted && next -> "Native updater events start now. Startup milestones are not reconstructed; relaunch with diagnostics on to capture them."
                persisted -> "Native diagnostics stopped. Saved reports remain until cleared."
                !next -> "Native diagnostics stopped immediately, but the off choice could not be saved and may not survive an app restart."
                else -> "Native diagnostics could not be started or saved; collection remains off. Check local storage and retry."
            }
            Toast.makeText(this,message,Toast.LENGTH_LONG).show()
        }
        nativeDiagnosticsReportButton=button(110,"View Android updater diagnostics") { showNativeDiagnosticsReport() }
        nativeDiagnosticsClearButton=button(111,"Clear Android updater diagnostics") { confirmClearNativeDiagnostics() }
        val width=minOf(resources.displayMetrics.widthPixels,dp(760))
        scroll.addView(body,FrameLayout.LayoutParams(width,-2,Gravity.CENTER_HORIZONTAL)); setContentView(scroll)
        renderNativeDiagnosticsControls()
        renderInstallPermissionState()
    }
    /** State drawables apply immediately, including disabled-before-first-focus and touch press. */
    private fun styleButton(button: Button) {
        val disabled=intArrayOf(-android.R.attr.state_enabled)
        val focused=intArrayOf(android.R.attr.state_focused)
        val pressed=intArrayOf(android.R.attr.state_pressed)
        val normal=intArrayOf()
        fun shape(color: Int,stroke: Int)=GradientDrawable().apply {
            setColor(color); cornerRadius=dp(24).toFloat(); setStroke(dp(2),stroke)
        }
        button.backgroundTintList=null
        button.stateListAnimator=null
        button.background=StateListDrawable().apply {
            addState(disabled,shape(NativeThemePolicy.disabledSurface(),NativeThemePolicy.divider()))
            addState(focused,shape(NativeThemePolicy.focus(),NativeThemePolicy.focus()))
            addState(pressed,shape(NativeThemePolicy.focus(),NativeThemePolicy.focus()))
            addState(normal,shape(NativeThemePolicy.card(),NativeThemePolicy.card()))
        }
        button.setTextColor(ColorStateList(arrayOf(disabled,focused,pressed,normal),intArrayOf(
            NativeThemePolicy.disabledText(),NativeThemePolicy.onFocus(),NativeThemePolicy.onFocus(),NativeThemePolicy.primaryText())))
    }
    private fun showNotes(title: String,body: String,source: Button) {
        val dialog=AlertDialog.Builder(this,android.R.style.Theme_Material_Dialog_Alert)
            .setTitle(title).setMessage(body).setPositiveButton("Back",null).create()
        dialog.setOnDismissListener { if(source.isEnabled && source.visibility==View.VISIBLE) source.requestFocus() else intervalButton.requestFocus() }
        dialog.show()
        styleButton(dialog.getButton(AlertDialog.BUTTON_POSITIVE))
    }
    private fun renderNativeDiagnosticsControls() {
        val enabled=AndroidDiagnostics.enabled()
        nativeDiagnosticsToggleButton.text=if(enabled) "Disable Android updater diagnostics" else "Enable Android updater diagnostics"
        nativeDiagnosticsToggleButton.contentDescription=if(enabled) "Stop native updater diagnostics collection" else "Start opt-in native updater diagnostics collection"
        nativeDiagnosticsReportButton.isEnabled=true
        nativeDiagnosticsClearButton.isEnabled=true
    }

    private fun showNativeDiagnosticsReport() {
        val body=TextView(this).apply {
            text=AndroidDiagnostics.report()
            textSize=14f
            setTextColor(NativeThemePolicy.primaryText())
            setPadding(dp(20),dp(12),dp(20),dp(12))
            isFocusable=false
        }
        val content=ScrollView(this).apply {
            isFillViewport=true
            isFocusable=true
            isFocusableInTouchMode=true
            addView(body)
        }
        val dialog=AlertDialog.Builder(this,android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Android updater diagnostics")
            .setView(content)
            .setPositiveButton("Back",null)
            .create()
        dialog.setOnDismissListener { if(nativeDiagnosticsReportButton.isEnabled) nativeDiagnosticsReportButton.requestFocus() }
        dialog.show()
        styleButton(dialog.getButton(AlertDialog.BUTTON_POSITIVE))
        content.requestFocus()
    }

    private fun confirmClearNativeDiagnostics() {
        val dialog=AlertDialog.Builder(this,android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Clear Android updater diagnostics?")
            .setMessage("Only the local Android updater diagnostic events will be cleared. The enable choice, update settings, accounts, cookies, downloaded or staged APKs, and browser diagnostics are not changed.")
            .setPositiveButton("Clear") { _, _ ->
                val cleared=AndroidDiagnostics.clear()
                renderNativeDiagnosticsControls()
                Toast.makeText(this,if(cleared) "Android updater diagnostic events cleared." else "Android updater diagnostic storage could not confirm clearing; check local storage and retry.",Toast.LENGTH_LONG).show()
            }
            .setNegativeButton("Back",null)
            .create()
        dialog.setOnDismissListener { if(nativeDiagnosticsClearButton.isEnabled) nativeDiagnosticsClearButton.requestFocus() }
        dialog.show()
        styleButton(dialog.getButton(AlertDialog.BUTTON_POSITIVE))
        styleButton(dialog.getButton(AlertDialog.BUTTON_NEGATIVE))
    }

    private fun renderInstallPermissionState(message: String? = null) {
        val granted = InstallAuthorizationAccess.granted(this)
        val allowed = granted == true
        val diagnose = InstallAuthorizationAccess.diagnose(this)
        val canHold = InstallAuthorizationAccess.canHoldAuthorization(this)
        installPermissionInfo.text = message ?: when {
            permissionDetours.current?.returned == true -> "Returned from Android install settings. YTArk is rechecking authorization and the same update; it will not install without Android's approval."
            permissionRouteInFlight -> "Android install settings are open. Choose Allow for YTArk or press Back. Nothing is downloaded or installed by this request."
            permissionDetours.current != null -> "An Android install-authorization request is being prepared. No update is downloaded or installed by this request."
            allowed -> "Install authorization is available for YTArk. Opening Updates never starts a download or install."
            // The installed build's own configuration decides this on Android
            // 8+: Android refuses a package that targets below API 26 or does
            // not request the permission, and no settings screen can change
            // that. On API 24–25 the legacy global setting applies instead,
            // and the platform-appropriate explanation says so.
            !canHold -> InstallAuthorizationAccess.explanation(this)
            else -> InstallCapabilityPolicy.explanation(diagnose, android.os.Build.VERSION.SDK_INT) +
                if (granted == false) InstallAuthorizationAccess.appOpNote(this) else ""
        }
        allowInstallsButton.visibility = if (allowed) View.GONE else View.VISIBLE
        allowInstallsButton.isEnabled = permissionDetours.current == null
        allowInstallsButton.contentDescription = if (allowed) "Install authorization already allowed for YTArk" else "Allow YTArk to request Android's install-unknown-apps authorization"
        // When the Allow button disappears on a grant, keep the remote on an
        // enabled, visible action instead of letting focus fall nowhere.
        if (allowed && currentFocus === allowInstallsButton) requestFallbackFocus()
    }

    /** First enabled, visible action in remote order; the interval row is always usable. */
    private fun requestFallbackFocus() {
        val target = listOf(checkButton, primaryButton, cancelButton, detailsButton, currentNotesButton, candidateNotesButton, intervalButton)
            .firstOrNull { it.isEnabled && it.visibility == View.VISIBLE }
            ?: intervalButton
        focusId = target.id
        target.requestFocus()
    }

    private val detourPrefs by lazy { getSharedPreferences("ytark_permission_detour", MODE_PRIVATE) }

    private fun reconcileMissingPermissionRoute(state: UpdateState) {
        if (!recoverMissingPermissionRoute) return
        if (permissionDetours.current != null) {
            recoverMissingPermissionRoute=false
            return
        }
        if (state.phase == UpdatePhase.AwaitingPermission) {
            recoverMissingPermissionRoute=false
            // Update state is restored separately from the Activity-owned route.
            // If only the state survived process recreation, clear the stale
            // authorization request and keep the validated APK retryable.
            updates.clearPermissionRequest(state.pendingIdentity)
        } else if (state.phase != UpdatePhase.Validating) {
            recoverMissingPermissionRoute=false
        }
    }

    private fun readPermissionDetourSnapshot(saved: Bundle?): PermissionDetourSnapshot {
        val persisted = permissionDetourSnapshot(
            detourPrefs.getLong("next_id", 1L), detourPrefs.getLong("revision", 0L),
            detourPrefs.getBoolean("active", false), detourPrefs.getLong("id", 0L),
            detourPrefs.getString("owner", null), detourPrefs.getString("candidate", null),
            detourPrefs.getBoolean("launched", false), detourPrefs.getBoolean("departed", false),
            detourPrefs.getBoolean("returned", false), detourPrefs.getBoolean("accepted", false),
        )
        val restored = if (saved != null && saved.containsKey("detour_revision")) permissionDetourSnapshot(
            saved.getLong("detour_next_id", 1L), saved.getLong("detour_revision", 0L),
            saved.getBoolean("detour_active", false), saved.getLong("detour_id", 0L),
            saved.getString("detour_owner"), saved.getString("detour_candidate"),
            saved.getBoolean("detour_launched", false), saved.getBoolean("detour_departed", false),
            saved.getBoolean("detour_returned", false), saved.getBoolean("detour_accepted", false),
        ) else null
        return PermissionDetourSnapshot.mostRecent(persisted, restored)
    }

    private fun permissionDetourSnapshot(
        next: Long, revision: Long, active: Boolean, requestId: Long, ownerName: String?,
        candidate: String?, launched: Boolean, departed: Boolean, returned: Boolean, accepted: Boolean,
    ): PermissionDetourSnapshot {
        if (!active) return PermissionDetourSnapshot(next.coerceAtLeast(1L), null, revision.coerceAtLeast(0L))
        val owner = try { PermissionDetourOwner.valueOf(ownerName ?: "") }
        catch (_: Exception) { return PermissionDetourSnapshot(next.coerceAtLeast(1L), null, revision.coerceAtLeast(0L)) }
        return PermissionDetourSnapshot(
            next.coerceAtLeast(1L),
            PermissionDetour(requestId, owner, candidate?.takeIf { it.isNotEmpty() }, launched, departed, returned, accepted),
            revision.coerceAtLeast(0L),
        )
    }

    private fun persistPermissionDetourState(out: Bundle? = null) {
        val snapshot = permissionDetours.snapshot()
        val route = snapshot.current
        val editor = detourPrefs.edit().putLong("next_id", snapshot.nextRequestId)
            .putLong("revision", snapshot.revision).putBoolean("active", route != null)
        if (route != null) {
            editor.putLong("id", route.requestId).putString("owner", route.owner.name)
                .putString("candidate", route.candidateIdentity ?: "")
                .putBoolean("launched", route.launched).putBoolean("departed", route.departed)
                .putBoolean("returned", route.returned).putBoolean("accepted", route.continuationAccepted)
        } else {
            editor.remove("id").remove("owner").remove("candidate").remove("launched")
                .remove("departed").remove("returned").remove("accepted")
        }
        editor.commit()
        if (out != null) {
            out.putLong("detour_next_id", snapshot.nextRequestId)
            out.putLong("detour_revision", snapshot.revision)
            out.putBoolean("detour_active", route != null)
            if (route != null) {
                out.putLong("detour_id", route.requestId)
                out.putString("detour_owner", route.owner.name)
                out.putString("detour_candidate", route.candidateIdentity)
                out.putBoolean("detour_launched", route.launched)
                out.putBoolean("detour_departed", route.departed)
                out.putBoolean("detour_returned", route.returned)
                out.putBoolean("detour_accepted", route.continuationAccepted)
            }
        }
    }

    internal fun currentPermissionDetour(): PermissionDetour? = permissionDetours.current

    internal fun focusPermissionRetry() {
        focusId = 108
        if (!visible) return
        window?.decorView?.post {
            if (visible && allowInstallsButton.isEnabled && allowInstallsButton.visibility == View.VISIBLE) {
                allowInstallsButton.requestFocus()
            }
        }
    }

    internal fun acceptPermissionContinuation(requestId: Long, candidateIdentity: String): Boolean {
        if (!permissionDetours.acceptContinuation(requestId, candidateIdentity)) return false
        AndroidDiagnostics.record("permission_continuation_queued", "accepted")
        permissionDetours.complete(requestId)
        persistPermissionDetourState()
        return true
    }

    internal fun completePermissionRoute(requestId: Long) {
        if (permissionDetours.complete(requestId)) persistPermissionDetourState()
    }

    internal fun cancelInstallPermissionRoute(requestId: Long, candidateIdentity: String) {
        if (permissionDetours.detachCandidate(requestId, candidateIdentity)) persistPermissionDetourState()
    }

    internal fun reserveInstallPermissionRoute(candidateIdentity: String): PermissionDetourStart {
        val result = permissionDetours.beginInstall(candidateIdentity)
        persistPermissionDetourState()
        when (result.kind) {
            PermissionDetourStartKind.STARTED -> AndroidDiagnostics.permissionRoute("requested", result.route?.owner, "install")
            PermissionDetourStartKind.JOINED -> AndroidDiagnostics.permissionRoute("joined", result.route?.owner, "install")
            else -> Unit
        }
        return result
    }

    /** Launches only a reserved route; joining an entry route never opens another Settings screen. */
    internal fun launchReservedInstallPermissionRoute(requestId: Long): String? {
        val route = permissionDetours.current ?: return InstallAuthorizationAccess.OPEN_BLOCKED
        if (route.requestId != requestId) return InstallAuthorizationAccess.OPEN_BLOCKED
        if (route.owner == PermissionDetourOwner.ENTRY && route.launched) return null
        if (route.launched) return null
        if (!visible || isFinishing || !InstallAuthorizationAccess.canHoldAuthorization(this)) {
            permissionDetours.markLaunchFailed(requestId)
            persistPermissionDetourState()
            return if (visible) InstallAuthorizationAccess.OPEN_BLOCKED else InstallAuthorizationAccess.OPEN_UNAVAILABLE
        }
        val requestCode = if (route.owner == PermissionDetourOwner.ENTRY) ENTRY_PERMISSION else InstallCoordinator.PERMISSION
        val outcome = InstallAuthorizationAccess.openSettings(this, requestCode)
        if (outcome == null) {
            permissionDetours.markLaunched(requestId)
            persistPermissionDetourState()
            AndroidDiagnostics.permissionRoute("launched", route.owner, "install")
            return null
        }
        permissionDetours.markLaunchFailed(requestId)
        persistPermissionDetourState()
        AndroidDiagnostics.permissionRoute("failed", route.owner, if (outcome == InstallAuthorizationAccess.OPEN_UNAVAILABLE) "unavailable" else "blocked")
        return outcome
    }

    /** One automatic authorization route for a deliberate fresh page entry only. */
    private fun beginFreshPageEntry() {
        if (!freshEntryPending) return
        freshEntryPending = false
        val granted = InstallAuthorizationAccess.granted(this)
        val shouldRequest = InstallAuthorizationAccess.canHoldAuthorization(this) &&
            !installerRouteOwnsSettings() && permissionDetours.current == null &&
            InstallPermissionEntryPolicy.shouldRequestOnEntry(true, granted, permissionEntryAttempted, permissionRouteInFlight)
        permissionEntryAttempted = true
        if (!shouldRequest) { renderInstallPermissionState(); return }
        renderInstallPermissionState()
        window?.decorView?.post {
            if (visible && !isFinishing && !installerRouteOwnsSettings()) launchInstallAuthorizationSettings()
        }
    }

    private fun installerRouteOwnsSettings(): Boolean =
        updates.state.phase == UpdatePhase.AwaitingPermission || updates.state.phase == UpdatePhase.AwaitingInstaller

    private fun allowInstallAuthorization() {
        val granted = InstallAuthorizationAccess.granted(this) == true
        if (!InstallPermissionEntryPolicy.shouldOpenFromAction(granted, permissionRouteInFlight)
            || permissionDetours.current != null) {
            renderInstallPermissionState()
            return
        }
        permissionEntryAttempted = true
        launchInstallAuthorizationSettings()
    }

    private fun launchInstallAuthorizationSettings() {
        if (!visible || permissionRouteInFlight || permissionDetours.current != null) return
        if (InstallAuthorizationAccess.granted(this) == true) {
            renderInstallPermissionState(); focusId = 101; checkButton.requestFocus(); return
        }
        if (!InstallAuthorizationAccess.canHoldAuthorization(this)) {
            renderInstallPermissionState(InstallAuthorizationAccess.explanation(this))
            allowInstallsButton.isEnabled = true
            return
        }
        if (installerRouteOwnsSettings()) { renderInstallPermissionState(); return }
        val start = permissionDetours.beginEntry()
        if (start.kind != PermissionDetourStartKind.STARTED || start.route == null) return
        persistPermissionDetourState()
        AndroidDiagnostics.permissionRoute("requested", PermissionDetourOwner.ENTRY, "entry")
        renderInstallPermissionState()
        val outcome = InstallAuthorizationAccess.openSettings(this, ENTRY_PERMISSION)
        if (outcome == null) {
            permissionDetours.markLaunched(start.route.requestId)
            persistPermissionDetourState()
            AndroidDiagnostics.permissionRoute("launched", PermissionDetourOwner.ENTRY, "entry")
            return
        }
        permissionDetours.markLaunchFailed(start.route.requestId)
        persistPermissionDetourState()
        AndroidDiagnostics.permissionRoute("failed", PermissionDetourOwner.ENTRY,
            if (outcome == InstallAuthorizationAccess.OPEN_UNAVAILABLE) "unavailable" else "blocked")
        renderInstallPermissionState(if (outcome == InstallAuthorizationAccess.OPEN_UNAVAILABLE)
            "This Android version has no supported install-authorization screen. Check this TV's Security settings; update checks and release notes remain available."
        else "Android could not open the install-authorization screen. Check this TV's Security settings, then select Allow installs to retry.")
        allowInstallsButton.isEnabled = true
    }

    private fun observePermissionReturn(requestCode: Int? = null, fromActivityResult: Boolean = false) {
        val route = permissionDetours.current ?: return
        if (requestCode != null) {
            val expected = if (route.owner == PermissionDetourOwner.ENTRY) ENTRY_PERMISSION else InstallCoordinator.PERMISSION
            if (requestCode != expected) return
        }
        if (permissionDetours.observeReturn(route.requestId, fromActivityResult)) {
            persistPermissionDetourState()
            AndroidDiagnostics.permissionRoute("returned", route.owner,
                if (InstallAuthorizationAccess.granted(this) == true) "granted" else if (InstallAuthorizationAccess.granted(this) == false) "denied" else "unknown")
        }
    }

    private fun finishEntryPermissionReturn() {
        val route = permissionDetours.current ?: return
        if (route.owner != PermissionDetourOwner.ENTRY || !route.returned) return
        if (route.candidateIdentity != null) {
            installer.stateChanged(updates.state)
            renderInstallPermissionState()
            return
        }
        permissionDetours.complete(route.requestId)
        persistPermissionDetourState()
        val granted = InstallAuthorizationAccess.granted(this)
        val canHold = InstallAuthorizationAccess.canHoldAuthorization(this)
        renderInstallPermissionState(when {
            granted == true -> "Install authorization is now allowed for YTArk. This does not start a download or installation."
            !canHold -> InstallAuthorizationAccess.explanation(this)
            granted == false && android.os.Build.VERSION.SDK_INT in 24..25 ->
                InstallCapabilityPolicy.explanation(InstallAuthorizationAccess.diagnose(this), android.os.Build.VERSION.SDK_INT) + " Select Allow installs to try again."
            granted == false -> "Install authorization is still off. You can check for updates and read notes; select Allow installs to try again."
            else -> "YTArk could not verify install authorization after returning. Checks and release notes remain available; select Allow installs to retry."
        })
        focusId = if (granted == true) 101 else 108
        window?.decorView?.post {
            if (!visible) return@post
            val target = if (granted == true) checkButton else allowInstallsButton
            if (target.isEnabled && target.visibility == View.VISIBLE) target.requestFocus()
        }
    }

    private fun dp(n: Int)=(n*resources.displayMetrics.density).toInt()
    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent); setIntent(intent)
        if (intent?.action != InstallStatusContract.ACTION && permissionDetours.current == null) {
            // A new JNI navigation to Updates is a deliberate new page entry.
            permissionEntryAttempted = false
            freshEntryPending = true
            if (visible) beginFreshPageEntry()
        }
        consumeInstallStatus(intent)
    }
    override fun onResume() {
        super.onResume()
        visible=true
        AndroidDiagnostics.record("page_visible")
        observePermissionReturn()
        updates.observe(observer)
        consumeInstallStatus(intent)
        reconcileMissingPermissionRoute(updates.state)
        finishEntryPermissionReturn()
        beginFreshPageEntry()
        renderInstallPermissionState()
        if(updates.state.phase==UpdatePhase.AwaitingInstaller) window?.decorView?.postDelayed({ if(visible) updates.reconcileInstallerReturn() }, 1200)
        (findViewById<View>(focusId) ?: checkButton).let { if(it.isEnabled && it.visibility==View.VISIBLE) it.requestFocus() else requestFallbackFocus() }
    }
    override fun onPause() {
        // Departure belongs only to the outstanding request, never merely to
        // an AwaitingPermission state or installer status.
        if (permissionDetours.markDeparted()) {
            persistPermissionDetourState()
            AndroidDiagnostics.permissionRoute("departed", permissionDetours.current?.owner, "system-screen")
        }
        visible=false; updates.remove(observer); super.onPause()
    }
    override fun onSaveInstanceState(out: Bundle) {
        out.putInt("focus",currentFocus?.id ?: focusId)
        out.putBoolean("fresh_entry_pending",freshEntryPending)
        out.putBoolean("permission_entry_attempted",permissionEntryAttempted)
        persistPermissionDetourState(out)
        super.onSaveInstanceState(out)
    }
    override fun onActivityResult(request: Int,result: Int,data: Intent?) {
        super.onActivityResult(request,result,data)
        when (request) {
            ENTRY_PERMISSION -> {
                observePermissionReturn(ENTRY_PERMISSION, fromActivityResult=true)
                finishEntryPermissionReturn()
                installer.stateChanged(updates.state)
            }
            InstallCoordinator.PERMISSION -> {
                observePermissionReturn(InstallCoordinator.PERMISSION, fromActivityResult=true)
                installer.stateChanged(updates.state)
            }
            InstallCoordinator.INSTALLER -> {
                installer.result(request)
                focusId=103
            }
        }
    }
    private fun consumeInstallStatus(source: Intent?) {
        if(source?.action!=InstallStatusContract.ACTION) return
        val status=source.getIntExtra(android.content.pm.PackageInstaller.EXTRA_STATUS, Int.MIN_VALUE)
        if(status==Int.MIN_VALUE) return
        val message=source.getStringExtra(android.content.pm.PackageInstaller.EXTRA_STATUS_MESSAGE)
        source.action=null
        if(status==android.content.pm.PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION") val confirm=source.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
            updates.noteInstallUi()
            if(confirm!=null && !isFinishing) {
                try { startActivity(confirm) } catch (_: Exception) { updates.externalReturned("Android's installer could not be opened. Select Install update to retry.") }
            } else updates.externalReturned("Android's installer did not provide a confirmation screen. Select Install update to retry.")
            return
        }
        updates.onInstallStatus(status, message)
    }
    private fun render(s: UpdateState) {
        val focused=currentFocus
        val checked=if(s.lastSuccess>0) DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.SHORT).format(Date(s.lastSuccess)) else "Not yet"
        summary.text="Installed: $installed   •   Latest compatible: ${UpdatePresentation.latest(s)}\nLast successful check: $checked"
        val statusText=UpdatePresentation.status(s)
        if(status.text.toString()!=statusText) status.text=statusText
        // Download progress repaints the status line every tick; announcing
        // each byte count would flood screen-reader users. Phase-level
        // messages stay polite announcements.
        val liveRegion=if(s.phase==UpdatePhase.Downloading) View.ACCESSIBILITY_LIVE_REGION_NONE else View.ACCESSIBILITY_LIVE_REGION_POLITE
        if(status.accessibilityLiveRegion!=liveRegion) status.accessibilityLiveRegion=liveRegion
        intervalButton.text="Automatically check: "+when(s.hours) { 0 -> "Never"; 3 -> "Every 3 hours"; else -> "Every 1 hour" }
        checkButton.isEnabled=!s.busy
        checkButton.text=if(s.phase==UpdatePhase.Failed && (s.candidate==null || s.stage=="check")) "Retry check" else "Check for updates"
        primaryButton.text=when {
            s.verifiedPath!=null && s.phase==UpdatePhase.Failed -> "Retry install"
            s.verifiedPath!=null -> "Install update"
            s.phase==UpdatePhase.Failed && s.stage!="check" && s.candidate!=null -> "Retry download"
            else -> "Download & install"
        }
        primaryButton.isEnabled=!s.busy && s.candidate!=null
        primaryButton.contentDescription=if(s.candidate==null) "Download update unavailable. No compatible newer release found." else primaryButton.text
        cancelButton.visibility=if(s.phase==UpdatePhase.Downloading) View.VISIBLE else View.GONE
        progress.visibility=if(s.phase in setOf(UpdatePhase.Downloading,UpdatePhase.Validating)) View.VISIBLE else View.GONE
        progress.isIndeterminate=s.phase==UpdatePhase.Validating || (s.phase==UpdatePhase.Downloading && (s.candidate?.size ?: 0L)<=0L)
        progress.progress=if((s.candidate?.size ?: 0)>0) (s.bytes*1000/s.candidate!!.size).toInt() else 0
        val details=UpdatePresentation.technical(s)
        detailsButton.visibility=if(details.isBlank()) View.GONE else View.VISIBLE
        detailsButton.isEnabled=details.isNotBlank()
        candidateNotes.visibility=if(s.candidate!=null) View.VISIBLE else View.GONE
        candidateNotesButton.visibility=candidateNotes.visibility
        candidateNotes.text=s.candidate?.let { "Available ${it.version}\n${ReleaseHighlights.summary(it.version)}" } ?: ""
        // If an action becomes disabled/hidden, keep the remote on a usable control.
        // Ordinary progress renders leave the same view and focus untouched.
        if(focused!=null && (!focused.isEnabled || focused.visibility!=View.VISIBLE)) {
            when {
                focused===cancelButton && primaryButton.isEnabled -> { focusId=primaryButton.id; primaryButton.requestFocus() }
                else -> requestFallbackFocus()
            }
        }
    }

    companion object {
        private const val ENTRY_PERMISSION = 7310
    }
}
