package com.haruhay.backend.report;

import com.haruhay.backend.registration.FlowException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.Principal;
import java.time.LocalDate;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/owner/reports")
public class OwnerReportController {
    private static final int PREVIEW_LIMIT=20;
    private static final MediaType CSV=new MediaType("text","csv",StandardCharsets.UTF_8);
    private final OwnerReportService reports;

    public OwnerReportController(OwnerReportService reports) { this.reports=reports; }

    public record Preview(String report,String property,LocalDate from,LocalDate through,List<String> columns,
                          List<OwnerReportService.Metric> summary,List<List<Object>> rows,int rowCount,String snapshot) {}

    @GetMapping("/preview")
    public Preview preview(Principal owner,@RequestParam UUID propertyId,@RequestParam OwnerReportService.Kind type,
                           @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate from,
                           @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate through) {
        var report=reports.generate(owner.getName(),propertyId,type,from,through);
        var data=report.data();
        return new Preview(type.label,report.property(),report.from(),report.through(),data.columns(),data.summary(),
            data.rows().stream().limit(PREVIEW_LIMIT).toList(),data.rows().size(),fingerprint(csv(report)));
    }

    @GetMapping("/csv")
    public ResponseEntity<byte[]> download(Principal owner,@RequestParam UUID propertyId,@RequestParam OwnerReportService.Kind type,
                                           @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate from,
                                           @RequestParam(required=false) @DateTimeFormat(iso=DateTimeFormat.ISO.DATE) LocalDate through,
                                           @RequestParam String snapshot) {
        var report=reports.generate(owner.getName(),propertyId,type,from,through);
        byte[] csv=csv(report);
        if (!fingerprint(csv).equals(snapshot))
            throw new FlowException(409,"REPORT_CHANGED","Report records changed. Refresh the preview before downloading.");
        String range=report.from()==null?"current":report.from()+"-to-"+report.through();
        String filename="haruhay-"+type.name().toLowerCase(Locale.ROOT)+"-"+range+".csv";
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(CSV)
            .header(HttpHeaders.CONTENT_DISPOSITION,ContentDisposition.attachment().filename(filename).build().toString())
            .body(csv);
    }

    private static byte[] csv(OwnerReportService.Report report) {
        var result=new StringBuilder("\uFEFF");
        var data=report.data();
        int columns=data.columns().size();
        line(result,data.columns(),columns);
        for (var row:data.rows()) line(result,row,columns);
        line(result,List.of(),columns);
        line(result,List.of("Summary","Value"),columns);
        line(result,List.of("Property",report.property()),columns);
        line(result,List.of("Report",report.type().label),columns);
        line(result,List.of("Period (PHT)",report.from()==null?"Current snapshot":report.from()+" through "+report.through()),columns);
        for (var metric:data.summary())
            line(result,List.of(metric.label()+(metric.currency()?" (PHP)":""),metric.value()),columns);
        return result.toString().getBytes(StandardCharsets.UTF_8);
    }

    private static void line(StringBuilder out,List<?> values,int columns) {
        for (int column=0;column<columns;column++) {
            if (column>0) out.append(',');
            if (column<values.size()) out.append(cell(values.get(column)));
        }
        out.append("\r\n");
    }

    private static String cell(Object value) {
        if (value instanceof BigDecimal decimal) return decimal.toPlainString();
        if (value instanceof Number number) return number.toString();
        String text=value.toString();
        int start=0;
        while (start<text.length() && (Character.isWhitespace(text.charAt(start))||Character.isSpaceChar(text.charAt(start)))) start++;
        if ((!text.isEmpty() && "\t\r\n".indexOf(text.charAt(0))>=0)
                || (start<text.length() && "=+-@＝＋－＠".indexOf(text.charAt(start))>=0))
            text="'"+text;
        return "\""+text.replace("\"","\"\"")+"\"";
    }

    private static String fingerprint(byte[] csv) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(csv)); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
