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
    private lateinit var notes: TextView
    private lateinit var candidateNotes: TextView
    private lateinit var progress: ProgressBar
    private lateinit var checkButton: Button
    private lateinit var intervalButton: Button
    private lateinit var primaryButton: Button
    private lateinit var cancelButton: Button
    private lateinit var currentNotesButton: Button
    private lateinit var candidateNotesButton: Button
    private lateinit var detailsButton: Button
    private lateinit var installed: String
    var visible=false; private set
    private var focusId=101
    private val observer: (UpdateState)->Unit = { s -> render(s); installer.stateChanged(s) }
    override fun onCreate(saved: Bundle?) {
        setTheme(android.R.style.Theme_Material_NoActionBar)
        super.onCreate(saved)
        updates=UpdateCoordinator.get(this); installer=InstallCoordinator(this,updates)
        installed=try { packageManager.getPackageInfo(packageName,0).versionName ?: "Unknown" } catch (_: Exception) { "Unknown" }
        focusId=saved?.getInt("focus",101) ?: 101
        val scroll=ScrollView(this).apply { isFillViewport=true; setBackgroundColor(NativeThemePolicy.background()) }
        val body=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(dp(32),dp(24),dp(32),dp(24)) }
        fun text(size: Float, secondary: Boolean=false): TextView = TextView(this).apply {
            textSize=size; setTextColor(if(secondary) NativeThemePolicy.secondaryText() else NativeThemePolicy.primaryText())
            setPadding(0,dp(6),0,dp(6)); body.addView(this)
        }
        text(28f).text="YTArk Updates"
        summary=text(16f,true); status=text(18f)
        status.accessibilityLiveRegion=View.ACCESSIBILITY_LIVE_REGION_POLITE
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
        val width=minOf(resources.displayMetrics.widthPixels,dp(760))
        scroll.addView(body,FrameLayout.LayoutParams(width,-2,Gravity.CENTER_HORIZONTAL)); setContentView(scroll)
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
    private fun dp(n: Int)=(n*resources.displayMetrics.density).toInt()
    override fun onNewIntent(intent: Intent?) { super.onNewIntent(intent); setIntent(intent); consumeInstallStatus(intent) }
    override fun onResume() {
        super.onResume(); visible=true; updates.observe(observer); consumeInstallStatus(intent)
        if(updates.state.phase==UpdatePhase.AwaitingInstaller) window?.decorView?.postDelayed({ if(visible) updates.reconcileInstallerReturn() }, 1200)
        (findViewById<View>(focusId) ?: checkButton).let { if(it.isEnabled && it.visibility==View.VISIBLE) it.requestFocus() else intervalButton.requestFocus() }
    }
    override fun onPause() { visible=false; updates.remove(observer); super.onPause() }
    override fun onSaveInstanceState(out: Bundle) { out.putInt("focus",currentFocus?.id ?: focusId); super.onSaveInstanceState(out) }
    override fun onActivityResult(request: Int,result: Int,data: Intent?) { super.onActivityResult(request,result,data); installer.result(request); focusId=103 }
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
        intervalButton.text="Automatically check: "+when(s.hours) { 0 -> "Never"; 3 -> "Every 3 hours"; else -> "Every 1 hour" }
        checkButton.isEnabled=!s.busy
        checkButton.text=if(s.phase==UpdatePhase.Failed && s.candidate==null) "Retry check" else "Check for updates"
        primaryButton.text=when {
            s.verifiedPath!=null && s.phase==UpdatePhase.Failed -> "Retry install"
            s.verifiedPath!=null -> "Install update"
            s.phase==UpdatePhase.Failed && s.candidate!=null -> "Retry download"
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
            if(focused===cancelButton && primaryButton.isEnabled) primaryButton.requestFocus() else intervalButton.requestFocus()
        }
    }
}
