package io.github.twoarchiver.ytark.updater;

import java.io.IOException;

/** A checked update failure that carries its user-facing {@link UpdateFailure} reason. */
final class UpdateFailureException extends IOException {
    private static final long serialVersionUID = 1L;

    final UpdateFailure reason;

    UpdateFailureException(UpdateFailure reason, String detail) {
        super(detail == null || detail.length() == 0 ? reason.message() : detail);
        this.reason = reason;
    }

    UpdateFailureException(UpdateFailure reason, String detail, Throwable cause) {
        super(detail == null || detail.length() == 0 ? reason.message() : detail, cause);
        this.reason = reason;
    }
}
