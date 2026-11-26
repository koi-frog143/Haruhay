package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

/** H2 and PostgreSQL assigned different names to the original unique constraint. */
public class V11__allow_tenancy_history extends BaseJavaMigration {
    @Override
    public void migrate(Context context) throws Exception {
        var connection = context.getConnection();
        String name;
        try (var query = connection.createStatement();
             var rows = query.executeQuery("""
                 SELECT tc.constraint_name FROM information_schema.table_constraints tc
                 JOIN information_schema.key_column_usage k
                   ON k.constraint_schema=tc.constraint_schema AND k.constraint_name=tc.constraint_name
                   AND k.table_name=tc.table_name AND k.table_schema=tc.table_schema
                 WHERE tc.table_schema=CURRENT_SCHEMA AND LOWER(tc.table_name)='tenancies'
                   AND tc.constraint_type='UNIQUE' AND LOWER(k.column_name)='application_id'
                 """)) {
            if (!rows.next()) throw new IllegalStateException("Missing tenancy application constraint");
            name = rows.getString(1);
        }
        try (var statement = connection.createStatement()) {
            statement.executeUpdate("ALTER TABLE tenancies DROP CONSTRAINT \"" + name.replace("\"", "\"\"") + "\"");
        }
    }
}
