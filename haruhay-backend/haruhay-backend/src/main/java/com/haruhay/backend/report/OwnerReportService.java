package com.haruhay.backend.report;

import com.haruhay.backend.registration.FlowException;
import com.haruhay.backend.registration.RoomAgreementService;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OwnerReportService {
    public enum Kind {
        COLLECTIONS("Billing and collections"), OCCUPANCY("Room occupancy"), RESIDENTS("Resident stays"),
        VISITORS("Visitor activity"), MAINTENANCE("Maintenance"), HOLDING("Holding Station");
        public final String label;
        Kind(String label) { this.label=label; }
    }
    public record Metric(String label,Number value,boolean currency) {
        Metric(String label,long value) { this(label,value,false); }
        Metric(String label,BigDecimal value) { this(label,value,true); }
    }
    record Data(List<String> columns,List<List<Object>> rows,List<Metric> summary) {}
    public record Report(Kind type,String property,LocalDate from,LocalDate through,Data data) {}
    private record Range(OffsetDateTime start,OffsetDateTime endExclusive) {}

    private static final ZoneId MANILA=ZoneId.of("Asia/Manila");
    private static final DateTimeFormatter DATE_TIME=DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm:ss");
    private final JdbcTemplate db;
    private final RoomAgreementService rooms;

    public OwnerReportService(JdbcTemplate db,RoomAgreementService rooms) {
        this.db=db;
        this.rooms=rooms;
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public Report generate(String email,UUID propertyId,Kind type,LocalDate from,LocalDate through) {
        String property=db.query("""
            SELECT p.name FROM properties p JOIN accounts a ON a.id=p.owner_id
            WHERE p.id=? AND a.email=? AND a.role='OWNER' AND p.sample=FALSE
            """,(row,index)->row.getString(1),propertyId,email).stream().findFirst()
            .orElseThrow(()->new FlowException(404,"REPORT_PROPERTY_NOT_FOUND","Choose a property you manage."));
        if (type==Kind.OCCUPANCY) return new Report(type,property,null,null,occupancy(email,propertyId));
        Range range=range(from,through);
        var data=switch(type) {
            case COLLECTIONS -> collections(propertyId,range);
            case RESIDENTS -> residents(propertyId,range);
            case VISITORS -> visitors(propertyId,range);
            case MAINTENANCE -> maintenance(propertyId,range);
            case HOLDING -> holding(propertyId,range);
            case OCCUPANCY -> throw new IllegalStateException("Occupancy is a current snapshot");
        };
        return new Report(type,property,from,through,data);
    }

    private Range range(LocalDate from,LocalDate through) {
        if (from==null || through==null || through.isBefore(from) || from.getYear()<1 || through.getYear()>9999)
            throw new FlowException(400,"REPORT_DATE_RANGE","Choose a valid start date and a through date on or after it.");
        return new Range(from.atStartOfDay(MANILA).toOffsetDateTime(),
            through.plusDays(1).atStartOfDay(MANILA).toOffsetDateTime());
    }

    private Data collections(UUID property,Range range) {
        record Entry(String time,String period,String kind,BigDecimal amount,String receipt) {}
        var entries=db.query("""
            SELECT l.recorded_at,b.period,l.kind,l.amount,r.number
            FROM bill_payment_ledger l JOIN bill_payment_submissions s ON s.id=l.payment_id
            JOIN monthly_bills b ON b.id=s.bill_id LEFT JOIN bill_payment_receipts r ON r.payment_id=s.id
            WHERE b.property_id=? AND s.property_id=b.property_id AND l.recorded_at>=? AND l.recorded_at<?
            ORDER BY l.recorded_at,l.id
            """,(row,index)->{
                Long receipt=row.getObject("number",Long.class);
                return new Entry(time(row.getObject("recorded_at",OffsetDateTime.class)),row.getString("period"),
                    row.getString("kind"),row.getBigDecimal("amount"),receipt==null?"":receipt.toString());
            },property,range.start(),range.endExclusive());
        BigDecimal verified=BigDecimal.ZERO,reversed=BigDecimal.ZERO;
        for (var entry:entries) {
            if ("PAYMENT".equals(entry.kind())) verified=verified.add(entry.amount());
            else reversed=reversed.subtract(entry.amount());
        }
        BigDecimal outstanding=db.queryForObject(
            "SELECT COALESCE(SUM(balance),0) FROM billing_balances WHERE property_id=?",BigDecimal.class,property);
        return new Data(List.of("Recorded at (PHT)","Billing month","Entry","Amount (PHP)","Receipt number"),
            entries.stream().map(entry->List.<Object>of(entry.time(),entry.period(),
                "PAYMENT".equals(entry.kind())?"Verified payment":"Reversal",entry.amount(),entry.receipt())).toList(),
            List.of(new Metric("Verified collections in range",verified),new Metric("Reversals in range",reversed),
                new Metric("Net collections in range",verified.subtract(reversed)),new Metric("Current outstanding balance",outstanding)));
    }

    private Data occupancy(String email,UUID property) {
        var inventory=rooms.ownerOccupancy(email,property);
        return new Data(List.of("Room","Capacity","Active occupants","Held reservations","Available slots"),
            inventory.stream().map(room->List.<Object>of(room.room(),room.capacity(),room.active(),room.held(),room.available())).toList(),
            List.of(new Metric("Total capacity",inventory.stream().mapToLong(RoomAgreementService.Occupancy::capacity).sum()),
                new Metric("Active occupants",inventory.stream().mapToLong(RoomAgreementService.Occupancy::active).sum()),
                new Metric("Held reservations",inventory.stream().mapToLong(RoomAgreementService.Occupancy::held).sum()),
                new Metric("Available slots",inventory.stream().mapToLong(RoomAgreementService.Occupancy::available).sum())));
    }

    private Data residents(UUID property,Range range) {
        var rows=db.query("""
            SELECT a.full_name,r.label,t.started_at,t.ended_at,t.status
            FROM tenancies t JOIN accounts a ON a.id=t.account_id JOIN rooms r ON r.id=t.room_id
            WHERE r.property_id=? AND t.started_at>=? AND t.started_at<?
            ORDER BY t.started_at,t.id
            """,(row,index)->List.<Object>of(row.getString("full_name"),row.getString("label"),
                time(row.getObject("started_at",OffsetDateTime.class)),time(row.getObject("ended_at",OffsetDateTime.class)),
                "ACTIVE".equals(row.getString("status"))?"Active":"Ended"),property,range.start(),range.endExclusive());
        return new Data(List.of("Resident","Room","Stay started (PHT)","Stay ended (PHT)","Current status"),
            rows,List.of(new Metric("Stays started in range",rows.size())));
    }

    private Data visitors(UUID property,Range range) {
        record Movement(String time,boolean entry,String visitor,String host,String room) {}
        var movements=db.query("""
            SELECT m.occurred_at,m.movement,vp.full_name AS visitor,a.full_name AS host,r.label
            FROM visitor_movements m JOIN visitor_visits v ON v.id=m.visit_id
            JOIN visitor_requests q ON q.id=v.request_id JOIN visitor_profiles vp ON vp.id=q.visitor_id
            JOIN tenancies t ON t.id=q.tenancy_id JOIN accounts a ON a.id=t.account_id JOIN rooms r ON r.id=t.room_id
            WHERE q.property_id=? AND r.property_id=q.property_id AND v.voided=FALSE AND m.occurred_at>=? AND m.occurred_at<?
            ORDER BY m.occurred_at,m.id
            """,(row,index)->new Movement(time(row.getObject("occurred_at",OffsetDateTime.class)),
                "ENTRY".equals(row.getString("movement")),row.getString("visitor"),row.getString("host"),row.getString("label")),
            property,range.start(),range.endExclusive());
        long entries=movements.stream().filter(Movement::entry).count();
        return new Data(List.of("Activity at (PHT)","Movement","Visitor","Host","Room"),
            movements.stream().map(m->List.<Object>of(m.time(),m.entry()?"Check-in":"Checkout",m.visitor(),m.host(),m.room())).toList(),
            List.of(new Metric("Check-ins in range",entries),new Metric("Checkouts in range",movements.size()-entries)));
    }

    private Data maintenance(UUID property,Range range) {
        record Ticket(String number,String category,String location,String time,String priority,String status) {}
        var tickets=db.query("""
            SELECT t.number,c.label,t.location,t.submitted_at,t.priority,t.status
            FROM maintenance_tickets t JOIN maintenance_categories c ON c.code=t.category
            WHERE t.property_id=? AND t.submitted_at>=? AND t.submitted_at<? ORDER BY t.submitted_at,t.id
            """,(row,index)->new Ticket("TCK-"+row.getLong("number"),row.getString("label"),row.getString("location"),
                time(row.getObject("submitted_at",OffsetDateTime.class)),row.getString("priority"),row.getString("status")),
            property,range.start(),range.endExclusive());
        long open=tickets.stream().filter(ticket->!"CLOSED".equals(ticket.status())&&!"CANCELLED".equals(ticket.status())).count();
        return new Data(List.of("Ticket","Category","Location","Submitted at (PHT)","Priority","Current status"),
            tickets.stream().map(t->List.<Object>of(t.number(),t.category(),t.location(),t.time(),label(t.priority()),label(t.status()))).toList(),
            List.of(new Metric("Tickets submitted in range",tickets.size()),new Metric("Still open from range",open)));
    }

    private Data holding(UUID property,Range range) {
        record Package(String code,String category,String shelf,String received,String collected,boolean claimed) {}
        var packages=db.query("""
            SELECT id,category,slot,received_at,claimed_at,status FROM holding_items
            WHERE property_id=? AND status IN ('READY','CLAIMED') AND received_at>=? AND received_at<? ORDER BY received_at,id
            """,(row,index)->new Package("HS-%04d".formatted(row.getLong("id")),row.getString("category"),row.getString("slot"),
                time(row.getObject("received_at",OffsetDateTime.class)),time(row.getObject("claimed_at",OffsetDateTime.class)),
                "CLAIMED".equals(row.getString("status"))),property,range.start(),range.endExclusive());
        long claimed=packages.stream().filter(Package::claimed).count();
        return new Data(List.of("Item code","Category","Shelf","Received at (PHT)","Collected at (PHT)","Current status"),
            packages.stream().map(p->List.<Object>of(p.code(),p.category(),p.shelf(),p.received(),p.collected(),p.claimed()?"Collected":"Ready for pickup")).toList(),
            List.of(new Metric("Items received in range",packages.size()),new Metric("Collected from range",claimed),
                new Metric("Still held from range",packages.size()-claimed)));
    }

    private String time(OffsetDateTime value) {
        return value==null?"":value.atZoneSameInstant(MANILA).format(DATE_TIME);
    }

    private String label(String value) {
        if ("READY".equals(value)) return "Ready for confirmation";
        String words=value.toLowerCase(java.util.Locale.ROOT).replace('_',' ');
        return Character.toUpperCase(words.charAt(0))+words.substring(1);
    }
}
