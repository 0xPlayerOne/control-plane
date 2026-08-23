terraform {
  backend "s3" {
    key          = "control-plane/production/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
