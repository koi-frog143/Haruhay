
package com.haruhay.backend.config;

import com.haruhay.backend.registration.AttemptLimiter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {
    @Bean PasswordEncoder passwords() { return new BCryptPasswordEncoder(12); }
    @Bean UserDetailsService users(JdbcTemplate db) {
        return email -> db.query("SELECT email,password_hash,role FROM accounts WHERE email=?",
            (r,n) -> User.withUsername(r.getString("email")).password(r.getString("password_hash"))
                .roles(r.getString("role")).build(), email.trim().toLowerCase(java.util.Locale.ROOT))
            .stream().findFirst().orElseThrow(() -> new UsernameNotFoundException("Invalid credentials"));
    }
    @Bean SecurityFilterChain securityFilterChain(HttpSecurity http, AttemptLimiter limiter, JdbcTemplate db) throws Exception {
        // Masked, session-backed CSRF tokens come from /api/auth/csrf, including after login/logout.
        http.authorizeHttpRequests(a -> a
            .requestMatchers("/api/public/**", "/api/auth/csrf", "/api/auth/login").permitAll()
            .requestMatchers("/api/owner/**").hasRole("OWNER")
            .requestMatchers("/api/resident/**").access((authentication, context) -> new AuthorizationDecision(
                db.queryForObject("SELECT count(*) FROM tenancies t JOIN accounts a ON a.id=t.account_id WHERE a.email=? AND t.status='ACTIVE'",
                    Integer.class, authentication.get().getName()) > 0))
            .requestMatchers("/api/account", "/api/account/**", "/api/auth/logout").authenticated()
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
        http.addFilterBefore(new OncePerRequestFilter() {
            @Override protected void doFilterInternal(HttpServletRequest q, HttpServletResponse s, FilterChain chain)
                    throws ServletException, IOException {
                if ((q.getRequestURI().startsWith("/api/public/") && !q.getRequestURI().endsWith("/health"))
                        || q.getRequestURI().equals("/api/auth/login") || q.getRequestURI().equals("/api/account/verification")
                        || q.getRequestURI().matches("/api/(account|owner)/admissions/[^/]+/(activate|resend)")) {
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
