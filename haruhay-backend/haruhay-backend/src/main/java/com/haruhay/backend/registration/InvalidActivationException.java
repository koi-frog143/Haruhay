package com.haruhay.backend.registration;
/** Incorrect code attempts must commit their counter without modifying the tenancy. */
public class InvalidActivationException extends FlowException {
    public InvalidActivationException(String message) { super(400,"INVALID_CODE",message); }
}
