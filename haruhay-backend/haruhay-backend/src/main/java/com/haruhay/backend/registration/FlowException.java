package com.haruhay.backend.registration;
public class FlowException extends RuntimeException {
    public final int status;
    public final String code;
    public FlowException(int status, String code, String message) { super(message); this.status=status; this.code=code; }
}
