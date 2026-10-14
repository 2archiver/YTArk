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
    check(!ScheduleRules.due(1,100000,0,0,100001))
    check(PendingInstallPolicy.mayContinue("a","a",true,true))
    check(!PendingInstallPolicy.mayContinue("a","b",true,true))
    check(!PendingInstallPolicy.mayContinue("a","a",false,true))
    check(!PendingInstallPolicy.mayContinue("a","a",true,false))
    check(!PendingInstallPolicy.mayContinue(null,"a",true,true))
    check(UpdateState(phase=UpdatePhase.AwaitingInstaller).busy)
    check(!UpdateState(phase=UpdatePhase.Ready).busy)
    println("Kotlin state/scheduling/permission identity tests passed (17 assertions).")
}
