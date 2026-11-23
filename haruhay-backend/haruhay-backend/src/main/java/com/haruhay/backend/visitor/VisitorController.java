package com.haruhay.backend.visitor;
import java.security.Principal;
import java.util.*;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/logbook")
public class VisitorController {
    private final VisitorService service;
    public VisitorController(VisitorService service){this.service=service;}
    @GetMapping("/properties") public Object properties(Principal p){return service.properties(p.getName());}
    @GetMapping("/hosts") public Object hosts(Principal p,@RequestParam(required=false) UUID property){return service.hosts(p.getName(),property);}
    @GetMapping("/records") public Object records(Principal p,@RequestParam(required=false) UUID property){return service.list(p.getName(),property);}
    @PostMapping("/requests") public Object request(Principal p,@RequestBody VisitorService.Request r){return Map.of("id",service.request(p.getName(),r));}
    @PostMapping("/requests/{id}/review") public Object review(Principal p,@PathVariable UUID id,@RequestBody VisitorService.Review r){return Collections.singletonMap("visitId",service.review(p.getName(),id,r));}
    @PostMapping("/requests/{id}/cancel") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT) public void cancel(Principal p,@PathVariable UUID id){service.cancel(p.getName(),id);}
    @PostMapping("/visits/{id}/pass") public ResponseEntity<VisitorService.IssuedPass> pass(Principal p,@PathVariable UUID id,@RequestBody VisitorService.Pass r){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.issue(p.getName(),id,r));}
    @PostMapping("/visits/{id}/pass/revoke") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT) public void revokePass(Principal p,@PathVariable UUID id,@RequestBody VisitorService.Review r){service.revokePass(p.getName(),id,r);}
    @PostMapping("/properties/{property}/scan") public Object scan(Principal p,@PathVariable UUID property,@RequestBody VisitorService.Scan s){return service.scan(p.getName(),property,s);}
    @PostMapping("/properties/{property}/visits/{id}/movement") public Object movement(Principal p,@PathVariable UUID property,@PathVariable UUID id,@RequestBody VisitorService.Movement m){return service.movement(p.getName(),property,id,m);}
    @PostMapping("/properties/{property}/visits/{id}/amend") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT) public void amend(Principal p,@PathVariable UUID property,@PathVariable UUID id,@RequestBody VisitorService.Review r){service.amend(p.getName(),property,id,r);}
    @GetMapping("/properties/{property}/visits/{id}/history") public Object history(Principal p,@PathVariable UUID property,@PathVariable UUID id){return service.history(p.getName(),property,id);}
    @PostMapping("/walk-ins") public Object walkin(Principal p,@RequestBody VisitorService.WalkIn r){return Map.of("visitId",service.walkin(p.getName(),r));}
    @GetMapping("/properties/{property}/guards") public Object guards(Principal p,@PathVariable UUID property){return service.guards(p.getName(),property);}
    @GetMapping("/properties/{property}/activity") public Object activity(Principal p,@PathVariable UUID property){return service.activity(p.getName(),property);}
    @PostMapping("/properties/{property}/guards") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT) public void guard(Principal p,@PathVariable UUID property,@RequestBody VisitorService.Guard g){service.createGuard(p.getName(),property,g);}
    @PostMapping("/properties/{property}/guards/{id}") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT) public void assignment(Principal p,@PathVariable UUID property,@PathVariable UUID id,@RequestBody VisitorService.Assignment g){service.assignment(p.getName(),property,id,g);}
}
