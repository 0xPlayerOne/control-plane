terraform {
  backend "s3" {
    key          = "control-plane/development/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
