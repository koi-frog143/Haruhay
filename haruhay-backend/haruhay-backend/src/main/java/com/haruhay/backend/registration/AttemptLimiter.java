package com.haruhay.backend.registration;

import java.time.Clock;
import java.util.HashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Bounded, per-process abuse protection; do not trust arbitrary forwarded client addresses. */
@Component
public class AttemptLimiter {
    private record Window(long start, int count) {}
    private final Map<String,Window> windows = new HashMap<>();
    private final int limit;
    private final Clock clock;
    public AttemptLimiter(@Value("${haruhay.attempt-limit:60}") int limit, Clock clock) { this.limit=limit; this.clock=clock; }
    public synchronized boolean allow(String address) {
        long now=clock.millis();
        windows.entrySet().removeIf(e -> now-e.getValue().start() >= 600_000);
        Window w=windows.get(address);
        if (w==null && windows.size()>=10_000) return false;
        if (w!=null && w.count()>=limit) return false;
        windows.put(address, new Window(w==null ? now : w.start(), w==null ? 1 : w.count()+1));
        return true;
    }
}
