
package com.haruhay.backend.config;

import com.haruhay.backend.registration.AttemptLimiter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {
    private static final class AccountUser extends User {
        private final UUID accountId;
        AccountUser(UUID id,String email,String hash,String role) {
            super(email,hash,List.of(new SimpleGrantedAuthority("ROLE_"+role)));
            this.accountId=id;
        }
    }

    @Bean PasswordEncoder passwords() { return new BCryptPasswordEncoder(12); }
    @Bean UserDetailsService users(JdbcTemplate db) {
        return email -> db.query("SELECT id,email,password_hash,role FROM accounts WHERE email=?",
            (r,n) -> new AccountUser(r.getObject("id",UUID.class),r.getString("email"),
                r.getString("password_hash"),r.getString("role")), email.trim().toLowerCase(java.util.Locale.ROOT))
            .stream().findFirst().orElseThrow(() -> new UsernameNotFoundException("Invalid credentials"));
    }
    @Bean SecurityFilterChain securityFilterChain(HttpSecurity http, AttemptLimiter limiter, JdbcTemplate db) throws Exception {
        // Masked, session-backed CSRF tokens come from /api/auth/csrf, including after login/logout.
        http.authorizeHttpRequests(a -> a
            .requestMatchers("/api/public/**", "/api/auth/csrf", "/api/auth/login").permitAll()
            .requestMatchers("/api/owner/**").hasRole("OWNER")
            .requestMatchers("/api/resident/bills", "/api/resident/payments", "/api/resident/payments/**")
            .access((authentication, context) -> new AuthorizationDecision(
                db.queryForObject("SELECT count(*) FROM tenancies t JOIN accounts a ON a.id=t.account_id WHERE a.email=?",
                    Integer.class,authentication.get().getName())>0))
            .requestMatchers("/api/resident/**").access((authentication, context) -> new AuthorizationDecision(
                db.queryForObject("SELECT count(*) FROM tenancies t JOIN accounts a ON a.id=t.account_id WHERE a.email=? AND t.status='ACTIVE'",
                    Integer.class, authentication.get().getName()) > 0))
            .requestMatchers("/api/logbook/**").access((authentication, context) -> new AuthorizationDecision(
                db.queryForObject("""
                    SELECT count(*) FROM accounts a WHERE a.email=? AND (a.role='OWNER' OR
                    EXISTS(SELECT 1 FROM property_guard_assignments g WHERE g.account_id=a.id AND g.enabled=TRUE) OR
                    (EXISTS(SELECT 1 FROM tenancies t WHERE t.account_id=a.id AND t.status='ACTIVE')
                      AND NOT EXISTS(SELECT 1 FROM property_guard_assignments g WHERE g.account_id=a.id)
                      AND NOT EXISTS(SELECT 1 FROM maintenance_staff s WHERE s.account_id=a.id)))
                    """,Integer.class,authentication.get().getName())>0))
            .requestMatchers("/api/account", "/api/account/**", "/api/auth/logout", "/api/maintenance/**").authenticated()
            .anyRequest().denyAll())
            .requestCache(c -> c.disable())
            .formLogin(f -> f.loginProcessingUrl("/api/auth/login")
                .successHandler((q,s,a) -> { s.setContentType("application/json"); s.getWriter().write("{\"message\":\"Signed in\"}"); })
                .failureHandler((q,s,e) -> { s.setStatus(401); s.setContentType("application/json"); s.getWriter().write("{\"message\":\"Email or password is incorrect.\"}"); }))
            .logout(l -> l.logoutUrl("/api/auth/logout").logoutSuccessHandler((q,s,a) -> s.setStatus(204)))
            .exceptionHandling(e -> e.authenticationEntryPoint((q,s,x) -> {
                s.setStatus(401); s.setContentType("application/json"); s.getWriter().write("{\"message\":\"Sign in to continue.\"}");
            }).accessDeniedHandler((q,s,x) -> {
                s.setStatus(403); s.setContentType("application/json"); s.getWriter().write("{\"message\":\"Access denied or security token expired. Refresh and try again.\"}");
            }));
        http.addFilterAfter(new OncePerRequestFilter() {
            @Override protected void doFilterInternal(HttpServletRequest q,HttpServletResponse s,FilterChain chain)
                    throws ServletException,IOException {
                var authentication=SecurityContextHolder.getContext().getAuthentication();
                if (authentication!=null && authentication.getPrincipal() instanceof AccountUser user &&
                    db.queryForObject("SELECT count(*) FROM accounts WHERE id=? AND email=?",Integer.class,user.accountId,user.getUsername())==0) {
                    var session=q.getSession(false);
                    if (session!=null) session.invalidate();
                    SecurityContextHolder.clearContext();
                }
                chain.doFilter(q,s);
            }
        },SecurityContextHolderFilter.class);
        http.addFilterBefore(new OncePerRequestFilter() {
            @Override protected void doFilterInternal(HttpServletRequest q, HttpServletResponse s, FilterChain chain)
                    throws ServletException, IOException {
                if ((q.getRequestURI().startsWith("/api/public/") && !q.getRequestURI().endsWith("/health"))
                        || q.getRequestURI().equals("/api/auth/login") || q.getRequestURI().equals("/api/account/verification")
                        || q.getRequestURI().equals("/api/resident/profile/email")
                        || q.getRequestURI().matches("/api/(account|owner)/admissions/[^/]+/(activate|resend)")
                        || q.getRequestURI().matches("/api/logbook/properties/[^/]+/(scan|visits/[^/]+/movement)")) {
                    if (!limiter.allow(q.getRemoteAddr())) {
                        s.setStatus(429); s.setHeader("Retry-After", "600"); s.setContentType("application/json");
                        s.getWriter().write("{\"message\":\"Too many attempts. Try again in ten minutes.\"}"); return;
                    }
                }
                chain.doFilter(q,s);
            }
        }, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}
