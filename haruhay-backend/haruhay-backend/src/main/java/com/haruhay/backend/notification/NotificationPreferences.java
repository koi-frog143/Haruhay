package com.haruhay.backend.notification;

import jakarta.validation.constraints.NotNull;
import java.sql.ResultSet;
import java.sql.SQLException;

public record NotificationPreferences(@NotNull Boolean announcements,@NotNull Boolean maintenance,@NotNull Boolean payments) {
    public static NotificationPreferences read(ResultSet row) throws SQLException {
        return new NotificationPreferences(row.getBoolean("notify_announcements"),
            row.getBoolean("notify_maintenance"),row.getBoolean("notify_payments"));
    }
}
