package io.github.twoarchiver.ytark.updater

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
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
    private lateinit var progress: ProgressBar
    private lateinit var checkButton: Button
    private lateinit var intervalButton: Button
    private lateinit var primaryButton: Button
    private lateinit var cancelButton: Button
    var visible=false; private set
    private var focusId=101
    private val observer: (UpdateState)->Unit = { s -> render(s); installer.stateChanged(s) }
    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved)
        updates=UpdateCoordinator.get(this); installer=InstallCoordinator(this,updates)
        focusId=saved?.getInt("focus",101) ?: 101
        val scroll=ScrollView(this).apply { isFillViewport=true; setBackgroundColor(NativeThemePolicy.background()) }
        val body=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(dp(40),dp(20),dp(40),dp(20)) }
        fun text(size: Float): TextView = TextView(this).apply { textSize=size; setTextColor(NativeThemePolicy.primaryText()); setPadding(0,dp(6),0,dp(6)); body.addView(this) }
        text(28f).text="YTArk Updates"
        summary=text(16f); status=text(18f)
        fun button(id: Int,label: String,action: ()->Unit) = Button(this).apply {
            this.id=id; text=label; textSize=18f; isAllCaps=false; isFocusable=true
            minHeight=dp(52)
            setOnClickListener { action() }
            setOnFocusChangeListener { _,focused ->
                if(focused) focusId=id
                background=GradientDrawable().apply { setColor(if(focused) 0xff315fa0.toInt() else NativeThemePolicy.card()); cornerRadius=dp(8).toFloat(); setStroke(dp(2),if(focused) 0xffffffff.toInt() else NativeThemePolicy.divider()) }
            }
            body.addView(this,LinearLayout.LayoutParams(-1,dp(56)).apply { bottomMargin=dp(8) })
        }
        checkButton=button(101,"Check for updates") { updates.check() }
        intervalButton=button(102,"Automatically check: Every 1 hour") {
            val choices=arrayOf("Every 1 hour","Every 3 hours","Never")
            val hours=intArrayOf(1,3,0)
            AlertDialog.Builder(this).setTitle("Automatically check").setSingleChoiceItems(choices,hours.indexOf(updates.state.hours)) { dialog,index -> updates.setHours(hours[index]); dialog.dismiss(); intervalButton.requestFocus() }.setNegativeButton("Back",null).show()
        }
        primaryButton=button(103,"Download update") { if(updates.state.verifiedPath!=null) installer.install() else updates.download() }
        progress=ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal).apply { max=1000; body.addView(this,LinearLayout.LayoutParams(-1,dp(10))) }
        cancelButton=button(104,"Cancel download") { updates.cancel() }
        text(16f).text="Automatic checks are approximate and may be deferred by Android. Downloads never open installation screens in the background."
        text(21f).text="What's new"
        notes=text(16f)
        scroll.addView(body); setContentView(scroll)
    }
    private fun dp(n: Int)=(n*resources.displayMetrics.density).toInt()
    override fun onResume() {
        super.onResume(); visible=true; updates.observe(observer)
        (findViewById<View>(focusId) ?: checkButton).let { if(it.isEnabled && it.visibility==View.VISIBLE) it.requestFocus() else checkButton.requestFocus() }
    }
    override fun onPause() { visible=false; updates.remove(observer); super.onPause() }
    override fun onSaveInstanceState(out: Bundle) { out.putInt("focus",currentFocus?.id ?: focusId); super.onSaveInstanceState(out) }
    override fun onActivityResult(request: Int,result: Int,data: Intent?) { super.onActivityResult(request,result,data); installer.result(request); focusId=103 }
    private fun render(s: UpdateState) {
        val installed=try { packageManager.getPackageInfo(packageName,0).versionName ?: "Unknown" } catch (_: Exception) { "Unknown" }
        val checked=if(s.lastSuccess>0) DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.SHORT).format(Date(s.lastSuccess)) else "Not yet"
        summary.text="Installed: $installed   •   Latest compatible: ${s.candidate?.version ?: "See status"}\nLast successful check: $checked"
        status.text=s.message
        intervalButton.text="Automatically check: "+when(s.hours) { 0 -> "Never"; 3 -> "Every 3 hours"; else -> "Every 1 hour" }
        checkButton.isEnabled=!s.busy
        primaryButton.text=if(s.verifiedPath!=null) "Install update" else "Download update"
        primaryButton.isEnabled=!s.busy && s.candidate!=null
        primaryButton.contentDescription=if(s.candidate==null) "Download update unavailable. Check for a compatible newer release first." else primaryButton.text
        cancelButton.visibility=if(s.phase==UpdatePhase.Downloading) View.VISIBLE else View.GONE
        progress.visibility=if(s.phase in setOf(UpdatePhase.Downloading,UpdatePhase.Validating)) View.VISIBLE else View.GONE
        progress.isIndeterminate=s.phase==UpdatePhase.Validating
        progress.progress=if((s.candidate?.size ?: 0)>0) (s.bytes*1000/s.candidate!!.size).toInt() else 0
        if(s.phase==UpdatePhase.Downloading) status.text="${s.message} ${s.bytes/1024/1024} / ${(s.candidate?.size ?: 0)/1024/1024} MB"
        notes.text=s.candidate?.notes?.ifBlank { "No release highlights provided." } ?: "Check for updates to read release highlights here."
    }
}
