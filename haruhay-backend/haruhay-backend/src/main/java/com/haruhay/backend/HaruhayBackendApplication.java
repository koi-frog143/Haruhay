package com.haruhay.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class HaruhayBackendApplication {

	public static void main(String[] args) {
		SpringApplication.run(HaruhayBackendApplication.class, args);
	}

}
