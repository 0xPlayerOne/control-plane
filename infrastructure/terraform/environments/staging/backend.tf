terraform {
  backend "s3" {
    key          = "control-plane/staging/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
