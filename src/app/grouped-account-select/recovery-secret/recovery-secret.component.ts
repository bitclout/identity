import { Component, Input } from '@angular/core';

@Component({
  selector: 'recovery-secret',
  templateUrl: './recovery-secret.component.html',
  styleUrls: ['./recovery-secret.component.scss']
})
export class RecoverySecretComponent {
  @Input() secret: string = '';

  isRevealed: boolean = false;
  copySuccess: boolean = false;

  maskSecret(secret: string) {
    return secret.slice().replace(/\S/g, '*');
  }

  copySecret() {
    window.navigator.clipboard.writeText(this.secret).then(() => {
      this.copySuccess = true;
      setTimeout(() => {
        this.copySuccess = false;
      }, 1500);
    });
  }

  toggleRevealSecret() {
    this.isRevealed = !this.isRevealed;
  }
}
