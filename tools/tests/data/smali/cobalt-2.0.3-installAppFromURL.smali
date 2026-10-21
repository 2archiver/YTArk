.method protected installAppFromURL(Ljava/lang/String;)Z
    .locals 3
    .param p1, "url"    # Ljava/lang/String;
    .annotation system Ldalvik/annotation/MethodParameters;
        accessFlags = {
            0x0
        }
        names = {
            "url"
        }
    .end annotation

    .line 1040
    invoke-static {}, Ljava/util/concurrent/Executors;->newSingleThreadExecutor()Ljava/util/concurrent/ExecutorService;

    move-result-object v0

    .line 1041
    .local v0, "executor":Ljava/util/concurrent/ExecutorService;
    new-instance v1, Landroid/os/Handler;

    invoke-static {}, Landroid/os/Looper;->getMainLooper()Landroid/os/Looper;

    move-result-object v2

    invoke-direct {v1, v2}, Landroid/os/Handler;-><init>(Landroid/os/Looper;)V

    .line 1042
    .local v1, "mainHandler":Landroid/os/Handler;
    new-instance v2, Ldev/cobalt/coat/BaseStarboardBridge$$ExternalSyntheticLambda2;

    invoke-direct {v2, p0, p1, v1, v0}, Ldev/cobalt/coat/BaseStarboardBridge$$ExternalSyntheticLambda2;-><init>(Ldev/cobalt/coat/BaseStarboardBridge;Ljava/lang/String;Landroid/os/Handler;Ljava/util/concurrent/ExecutorService;)V

    invoke-interface {v0, v2}, Ljava/util/concurrent/ExecutorService;->execute(Ljava/lang/Runnable;)V

    .line 1081
    const/4 v2, 0x1

    return v2
.end method
